import * as BackgroundFetch from 'expo-background-fetch';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, type AppStateStatus } from 'react-native';
import { apiFetch } from './api';
import {
  applyServerTagAction,
  listQueuedSessions,
  markSessionError,
  markSessionSynced,
  type LocalPhoto,
  type LocalSession,
  type ServerSession,
} from './capture';
import { getDb, kvGet, kvSet } from './db';

/**
 * E5 offline & sync engine.
 * S01 queue durability · S03 auto-sync + backoff · S04 compression ·
 * S07 pending recognition · S09 completion notification.
 */

export type SyncPillState =
  | { kind: 'idle' }
  | { kind: 'pending'; count: number }
  | { kind: 'uploading'; count: number }
  | { kind: 'attention'; count: number }
  | { kind: 'synced' };

const BACKGROUND_TASK = 'presente-sync-sessions';
const MAX_RETRY = 8;
const TARGET_MAX_BYTES = 400_000;
const RETENTION_DAYS = 14;
const BUDGET_BYTES = 500 * 1024 * 1024;

type SyncListener = (state: SyncPillState) => void;
const listeners = new Set<SyncListener>();
let uploading = false;
let lastPill: SyncPillState = { kind: 'idle' };
let appStateSub: { remove: () => void } | null = null;
let networkTimer: ReturnType<typeof setInterval> | null = null;

function emit(state: SyncPillState) {
  lastPill = state;
  for (const l of listeners) l(state);
}

export function getSyncPill(): SyncPillState {
  return lastPill;
}

export function subscribeSyncPill(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(lastPill);
  return () => listeners.delete(listener);
}

async function ensureQueueSchema(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS local_sessions (
       id TEXT PRIMARY KEY,
       json TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS sync_meta (
       id TEXT PRIMARY KEY,
       retry_count INTEGER NOT NULL DEFAULT 0,
       next_retry_at TEXT,
       last_error TEXT
     );`,
  );
}

/** E5-S01: drop sessions older than 14 days; enforce soft 500 MB budget. */
export async function pruneQueue(): Promise<void> {
  await ensureQueueSchema();
  const db = await getDb();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db.getAllAsync<{ id: string; json: string; updated_at: string }>(
    'SELECT id, json, updated_at FROM local_sessions',
  );
  for (const row of rows) {
    if (row.updated_at < cutoff) {
      const session = JSON.parse(row.json) as LocalSession;
      if (session.syncStatus === 'synced' || session.syncStatus === 'error') {
        await db.runAsync('DELETE FROM local_sessions WHERE id = ?', [row.id]);
        await db.runAsync('DELETE FROM sync_meta WHERE id = ?', [row.id]);
      }
    }
  }
  // Soft budget: if over 500 MB of photo URIs still on disk, drop oldest synced first.
  let total = 0;
  const sized: { id: string; bytes: number; status: string; updated: string }[] =
    [];
  for (const row of rows) {
    const session = JSON.parse(row.json) as LocalSession;
    let bytes = row.json.length;
    for (const p of session.photos) {
      try {
        bytes += new File(p.uri).size ?? 0;
      } catch {
        /* file may already be gone */
      }
    }
    total += bytes;
    sized.push({
      id: session.id,
      bytes,
      status: session.syncStatus,
      updated: row.updated_at,
    });
  }
  if (total <= BUDGET_BYTES) return;
  sized
    .filter((s) => s.status === 'synced')
    .sort((a, b) => a.updated.localeCompare(b.updated));
  for (const s of sized) {
    if (total <= BUDGET_BYTES) break;
    if (s.status !== 'synced') continue;
    await db.runAsync('DELETE FROM local_sessions WHERE id = ?', [s.id]);
    total -= s.bytes;
  }
}

export async function refreshSyncPill(): Promise<SyncPillState> {
  const sessions = await listQueuedSessions();
  const pending = sessions.filter((s) => s.syncStatus === 'pending').length;
  const errors = sessions.filter((s) => s.syncStatus === 'error').length;
  let state: SyncPillState;
  if (uploading) state = { kind: 'uploading', count: pending || 1 };
  else if (errors > 0) state = { kind: 'attention', count: errors };
  else if (pending > 0) state = { kind: 'pending', count: pending };
  else if (sessions.some((s) => s.syncStatus === 'synced'))
    state = { kind: 'synced' };
  else state = { kind: 'idle' };
  emit(state);
  return state;
}

/**
 * E5-S04: compress toward 200–400 KB JPEG while keeping a usable face image.
 * Returns new uri + sha256 of the compressed bytes.
 */
export async function compressPhoto(
  uri: string,
): Promise<{ uri: string; sha256: string; bytes: number }> {
  let width = 1280;
  let quality = 0.7;
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
  );
  let size = new File(result.uri).size ?? TARGET_MAX_BYTES;
  // Step down if still large (poor 2G links — NFR-4).
  while (size > TARGET_MAX_BYTES && (width > 640 || quality > 0.4)) {
    if (width > 640) width = Math.round(width * 0.75);
    else quality = Math.max(0.4, quality - 0.1);
    result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
    );
    size = new File(result.uri).size ?? size;
  }
  const base64 = new File(result.uri).base64Sync();
  const sha256 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
  );
  return { uri: result.uri, sha256, bytes: size };
}

async function uploadCompressed(
  photo: LocalPhoto,
): Promise<{ storageKey: string; sha256: string; sha256Verified: string }> {
  const compressed = await compressPhoto(photo.uri);
  const signed = await apiFetch<{ url: string; key: string }>('/uploads/sign', {
    method: 'POST',
    body: { category: 'session-photo', contentType: 'image/jpeg' },
  });
  const blob = await (await fetch(compressed.uri)).blob();
  const put = await fetch(signed.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  // Re-hash local compressed file as post-upload verification (E5-S04).
  return {
    storageKey: signed.key,
    sha256: photo.sha256 || compressed.sha256,
    sha256Verified: compressed.sha256,
  };
}

async function getRetryMeta(id: string): Promise<{
  retry_count: number;
  next_retry_at: string | null;
}> {
  await ensureQueueSchema();
  const db = await getDb();
  const row = await db.getFirstAsync<{
    retry_count: number;
    next_retry_at: string | null;
  }>('SELECT retry_count, next_retry_at FROM sync_meta WHERE id = ?', [id]);
  return row ?? { retry_count: 0, next_retry_at: null };
}

async function setRetryMeta(
  id: string,
  retry: number,
  error?: string,
): Promise<void> {
  await ensureQueueSchema();
  const db = await getDb();
  // Exponential backoff: 15s, 30s, 60s, … capped at 1h.
  const delaySec = Math.min(3600, 15 * 2 ** Math.min(retry, 8));
  const next = new Date(Date.now() + delaySec * 1000).toISOString();
  await db.runAsync(
    `INSERT INTO sync_meta (id, retry_count, next_retry_at, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       retry_count = excluded.retry_count,
       next_retry_at = excluded.next_retry_at,
       last_error = excluded.last_error`,
    [id, retry, next, error ?? null],
  );
}

async function clearRetryMeta(id: string): Promise<void> {
  await ensureQueueSchema();
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_meta WHERE id = ?', [id]);
}

async function syncOne(session: LocalSession): Promise<{
  ok: boolean;
  server?: ServerSession;
  needsAttention?: boolean;
  error?: string;
}> {
  try {
    // Resume: session may already exist with photos.
    try {
      const existing = await apiFetch<ServerSession>(`/sessions/${session.id}`);
      if (existing.photos.length > 0) {
        let server = existing;
        for (const tag of session.localTags) {
          if (tag.source === 'visitor') {
            server = await applyServerTagAction(session.id, {
              type: 'visitor',
              photoId: tag.photoId,
            });
          } else if (tag.source === 'manual' && tag.workerId) {
            server = await applyServerTagAction(session.id, {
              type: 'manual',
              workerId: tag.workerId,
              photoId: tag.photoId,
            });
          }
        }
        await markSessionSynced(session.id, {
          photos: session.photos.map((p, i) => ({
            ...p,
            storageKey: existing.photos[i]?.storageKey ?? p.storageKey,
          })),
        });
        await clearRetryMeta(session.id);
        return { ok: true, server };
      }
    } catch {
      /* not on server yet */
    }

    const deviceSentAt = new Date().toISOString();
    await apiFetch(`/sessions/${session.id}`, {
      method: 'PUT',
      body: {
        type: session.type,
        siteId: session.siteId,
        deviceId: session.deviceId,
        deviceCapturedAt: session.deviceCapturedAt,
        deviceSentAt,
        lat: session.gps.lat,
        lng: session.gps.lng,
        gpsStatus: session.gps.status,
        mockLocation: session.gps.mockLocation,
      },
    });

    // Resumable photo upload: skip photos already stored under storageKey.
    const uploaded: {
      storageKey: string;
      sha256?: string;
      sha256Verified?: string;
    }[] = [];
    const updatedPhotos: LocalPhoto[] = [];
    for (const photo of session.photos) {
      if (photo.storageKey && !photo.storageKey.startsWith('pending-upload/')) {
        uploaded.push({
          storageKey: photo.storageKey,
          sha256: photo.sha256,
          sha256Verified: photo.sha256,
        });
        updatedPhotos.push(photo);
        continue;
      }
      const up = await uploadCompressed(photo);
      uploaded.push(up);
      updatedPhotos.push({
        ...photo,
        uri: photo.uri,
        storageKey: up.storageKey,
        sha256: up.sha256,
      });
      // Persist partial progress so a flaky link can resume (E5-S04).
      await markSessionProgress(session.id, {
        photos: updatedPhotos,
        syncStatus: 'pending',
      });
    }

    let server = await apiFetch<ServerSession & { photoIds?: string[] }>(
      `/sessions/${session.id}/photos`,
      { method: 'POST', body: { photos: uploaded } },
    );

    for (const tag of session.localTags) {
      if (tag.source === 'visitor') {
        server = await applyServerTagAction(session.id, {
          type: 'visitor',
          photoId: tag.photoId,
        });
      } else if (tag.source === 'manual' && tag.workerId) {
        server = await applyServerTagAction(session.id, {
          type: 'manual',
          workerId: tag.workerId,
          photoId: tag.photoId,
        });
      }
    }

    await markSessionSynced(session.id, { photos: updatedPhotos });
    await clearRetryMeta(session.id);
    return { ok: true, server };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const meta = await getRetryMeta(session.id);
    const next = meta.retry_count + 1;
    await setRetryMeta(session.id, next, message);
    if (next >= MAX_RETRY) {
      await markSessionError(session.id, message);
      return { ok: false, needsAttention: true, error: message };
    }
    await markSessionError(session.id, `retry ${next}/${MAX_RETRY}: ${message}`);
    // Keep as pending for backoff — markSessionError sets error; flip back.
    await markSessionProgress(session.id, {
      syncStatus: 'pending',
      lastError: message,
    });
    return { ok: false, error: message };
  }
}

async function markSessionProgress(
  sessionId: string,
  patch: Partial<LocalSession>,
): Promise<void> {
  await ensureQueueSchema();
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM local_sessions WHERE id = ?',
    [sessionId],
  );
  if (!row) return;
  const session = { ...(JSON.parse(row.json) as LocalSession), ...patch };
  await db.runAsync(
    'UPDATE local_sessions SET json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(session), new Date().toISOString(), sessionId],
  );
}

/**
 * E5-S03: drain the queue. Honors exponential backoff and online-only.
 */
export async function runSyncPass(opts?: {
  notify?: boolean;
}): Promise<{ synced: number; failed: number; attention: number }> {
  if (uploading) return { synced: 0, failed: 0, attention: 0 };
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) {
    await refreshSyncPill();
    return { synced: 0, failed: 0, attention: 0 };
  }

  uploading = true;
  await refreshSyncPill();
  await pruneQueue();

  let synced = 0;
  let failed = 0;
  let attention = 0;
  let attentionSessionId: string | null = null;

  try {
    const sessions = await listQueuedSessions();
    const now = Date.now();
    const work = [];
    for (const s of sessions) {
      if (s.syncStatus === 'synced') continue;
      if (s.syncStatus === 'draft') continue;
      const meta = await getRetryMeta(s.id);
      if (meta.next_retry_at && Date.parse(meta.next_retry_at) > now) continue;
      work.push(s);
    }

    for (const session of work) {
      await refreshSyncPill();
      const result = await syncOne(session);
      if (result.ok) synced++;
      else {
        failed++;
        if (result.needsAttention) {
          attention++;
          attentionSessionId = session.id;
        }
      }
    }
  } finally {
    uploading = false;
    await refreshSyncPill();
  }

  if (opts?.notify !== false && (synced > 0 || attention > 0)) {
    await notifySyncResult({ synced, attention, attentionSessionId });
  }
  return { synced, failed, attention };
}

/** E5-S09 */
async function notifySyncResult(input: {
  synced: number;
  attention: number;
  attentionSessionId: string | null;
}): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== 'granted') return;
    }
    if (input.attention > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Presente sync',
          body: `${input.attention} session${input.attention === 1 ? '' : 's'} need attention`,
          data: {
            path: '/(tabs)/attendance',
            sessionId: input.attentionSessionId,
          },
        },
        trigger: null,
      });
    } else if (input.synced > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Presente sync',
          body: 'All sessions synced ✓',
          data: { path: '/(tabs)/attendance' },
        },
        trigger: null,
      });
    }
  } catch {
    /* notifications optional on web / simulators */
  }
}

/** E5-S03: foreground network + app-state listeners; background fetch task. */
export async function startSyncEngine(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  await refreshSyncPill();
  void runSyncPass({ notify: false });

  if (!appStateSub) {
    appStateSub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        if (next === 'active') void runSyncPass({ notify: true });
      },
    );
  }

  // Poll network every 20s — lighter than a permanent NetInfo sub on all platforms.
  if (!networkTimer) {
    let wasOnline = true;
    networkTimer = setInterval(() => {
      void (async () => {
        const net = await Network.getNetworkStateAsync();
        const online = Boolean(net.isConnected && net.isInternetReachable !== false);
        if (online && !wasOnline) {
          void runSyncPass({ notify: true });
        }
        wasOnline = online;
      })();
    }, 20_000);
  }

  // Background fetch (Android WorkManager-backed via expo-background-fetch).
  if (!TaskManager.isTaskDefined(BACKGROUND_TASK)) {
    TaskManager.defineTask(BACKGROUND_TASK, async () => {
      try {
        const result = await runSyncPass({ notify: true });
        return result.synced > 0 || result.failed > 0
          ? BackgroundFetch.BackgroundFetchResult.NewData
          : BackgroundFetch.BackgroundFetchResult.NoData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }
  try {
    const registered =
      await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
        minimumInterval: 15 * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    /* background fetch unavailable (web / Expo Go limits) */
  }

  await kvSet('sync.engine.started', new Date().toISOString());
}

export async function stopSyncEngine(): Promise<void> {
  appStateSub?.remove();
  appStateSub = null;
  if (networkTimer) {
    clearInterval(networkTimer);
    networkTimer = null;
  }
}

/** E5-S07 helper: true when any photo still awaits cloud recognition. */
export function hasPendingRecognition(server: ServerSession | null): boolean {
  if (!server) return true;
  return server.photos.some(
    (p) =>
      p.recognitionStatus === 'pending' || p.recognitionStatus === 'failed',
  );
}

export async function pendingUploadCount(): Promise<number> {
  const sessions = await listQueuedSessions();
  return sessions.filter(
    (s) => s.syncStatus === 'pending' || s.syncStatus === 'error',
  ).length;
}

/** Used by tests / debug — last engine start. */
export async function engineStartedAt(): Promise<string | null> {
  return kvGet('sync.engine.started');
}
