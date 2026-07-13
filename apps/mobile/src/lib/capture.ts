import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import * as Location from 'expo-location';
import { apiFetch } from './api';
import { getDb, kvGet, kvSet } from './db';
import { evaluateGeofence } from './geofence';
import * as SecureStore from './secure-store';

export type SessionType = 'time_in' | 'time_out';

export interface SiteDto {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  distanceM?: number;
  client?: string | null;
  address?: string | null;
}

export interface GpsFix {
  status: 'fix' | 'no_fix';
  lat?: number;
  lng?: number;
  accuracyM?: number;
  mockLocation: boolean;
  withinFence: boolean | null;
  distanceM: number | null;
}

export interface LocalPhoto {
  id: string;
  uri: string;
  sha256: string;
  storageKey?: string;
}

export interface LocalSession {
  id: string;
  type: SessionType;
  siteId: string;
  siteName: string;
  deviceId: string;
  deviceCapturedAt: string;
  gps: GpsFix;
  photos: LocalPhoto[];
  /** Local-only tag decisions before/alongside cloud recognition. */
  localTags: LocalTag[];
  syncStatus: 'draft' | 'pending' | 'synced' | 'error';
  lastError?: string;
}

export interface LocalTag {
  id: string;
  workerId?: string;
  workerName?: string;
  source: 'manual' | 'visitor' | 'confirm';
  photoId?: string;
}

export interface ServerTag {
  id: string;
  photoId: string | null;
  workerId: string | null;
  workerName: string | null;
  nickname: string | null;
  band: 'high' | 'confirm' | 'unrecognized' | null;
  confidence: number | null;
  source: string;
  status: string;
  notice: Record<string, unknown> | null;
}

export interface ServerSession {
  id: string;
  type: SessionType;
  siteId: string | null;
  siteName: string | null;
  gpsStatus: string;
  withinFence: boolean | null;
  distanceM: number | null;
  mockLocation: boolean;
  deviceCapturedAt: string;
  photos: {
    id: string;
    storageKey: string;
    recognitionStatus: string;
    tamperFlag: boolean;
  }[];
  tags: ServerTag[];
}

export interface WorkerDto {
  id: string;
  fullName: string;
  nickname: string | null;
  position: string | null;
  status: string;
  biometricStatus: string;
}

const LAST_SITE_KEY = 'capture.lastSiteId';
const DEVICE_ID_KEY = 'presente.deviceId';
const DRAFT_PREFIX = 'capture.draft.';

async function ensureSessionTable(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS local_sessions (
       id TEXT PRIMARY KEY,
       json TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
}

/** E4-S07 / FR-18: stable device id for anti-tamper + session metadata. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id =
    Device.osInternalBuildId ??
    Device.modelId ??
    (await Crypto.randomUUID());
  await SecureStore.setItemAsync(DEVICE_ID_KEY, String(id));
  return String(id);
}

/** E4-S01: nearest assigned site via GPS; offline falls back to last-used. */
export async function loadSitesForCapture(
  fix: GpsFix | null,
): Promise<{ sites: SiteDto[]; preselectedId: string | null; note?: string }> {
  try {
    if (fix?.status === 'fix' && fix.lat != null && fix.lng != null) {
      const sites = await apiFetch<SiteDto[]>(
        `/sites/nearest?lat=${fix.lat}&lng=${fix.lng}`,
      );
      await kvSet('capture.sites.cache', JSON.stringify(sites));
      const last = await kvGet(LAST_SITE_KEY);
      const preselectedId = sites[0]?.id ?? last;
      return { sites, preselectedId: preselectedId ?? null };
    }
    const sites = await apiFetch<SiteDto[]>('/sites');
    await kvSet('capture.sites.cache', JSON.stringify(sites));
    const last = await kvGet(LAST_SITE_KEY);
    return {
      sites,
      preselectedId: last ?? sites[0]?.id ?? null,
      note: 'GPS unavailable — pick a site manually',
    };
  } catch {
    const cached = await kvGet('capture.sites.cache');
    const sites: SiteDto[] = cached ? (JSON.parse(cached) as SiteDto[]) : [];
    const last = await kvGet(LAST_SITE_KEY);
    return {
      sites,
      preselectedId: last ?? sites[0]?.id ?? null,
      note: 'Offline — using last-known sites',
    };
  }
}

/**
 * E4-S05/S07: best-effort GPS + mock-location flag. Never throws — no-fix
 * is a first-class state (FR-16).
 */
export async function captureGpsFix(site: SiteDto | null): Promise<GpsFix> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return {
        status: 'no_fix',
        mockLocation: false,
        withinFence: null,
        distanceM: null,
      };
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const mockLocation = Boolean(
      // Android mock / developer options; iOS has no equivalent flag.
      (pos as { mocked?: boolean }).mocked ??
        (pos.coords as { mocked?: boolean }).mocked,
    );
    let withinFence: boolean | null = null;
    let distanceM: number | null = null;
    if (site) {
      const result = evaluateGeofence(
        { lat, lng },
        { lat: site.lat, lng: site.lng, radiusM: site.radiusM },
      );
      withinFence = result.withinFence;
      distanceM = Math.round(result.distanceM);
    }
    return {
      status: 'fix',
      lat,
      lng,
      accuracyM: pos.coords.accuracy ?? undefined,
      mockLocation,
      withinFence,
      distanceM,
    };
  } catch {
    return {
      status: 'no_fix',
      mockLocation: false,
      withinFence: null,
      distanceM: null,
    };
  }
}

/** E4-S08: SHA-256 at write time (same base64 digest path as enrollment). */
export async function hashPhotoUri(uri: string): Promise<string> {
  const base64 = new File(uri).base64Sync();
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
  );
}

export async function rememberLastSite(siteId: string): Promise<void> {
  await kvSet(LAST_SITE_KEY, siteId);
}

/** In-progress draft between capture screens (site → camera → tag → summary). */
export async function saveDraft(session: LocalSession): Promise<void> {
  await kvSet(DRAFT_PREFIX + session.id, JSON.stringify(session));
  await kvSet('capture.activeDraftId', session.id);
}

export async function loadDraft(
  sessionId?: string,
): Promise<LocalSession | null> {
  const id = sessionId ?? (await kvGet('capture.activeDraftId'));
  if (!id) return null;
  const raw = await kvGet(DRAFT_PREFIX + id);
  return raw ? (JSON.parse(raw) as LocalSession) : null;
}

export async function clearDraft(sessionId: string): Promise<void> {
  await kvSet(DRAFT_PREFIX + sessionId, '');
  const active = await kvGet('capture.activeDraftId');
  if (active === sessionId) await kvSet('capture.activeDraftId', '');
}

/** E4-S16: persist to encrypted local queue (sync-ready for E5). */
export async function enqueueSession(session: LocalSession): Promise<void> {
  await ensureSessionTable();
  const db = await getDb();
  const payload: LocalSession = { ...session, syncStatus: 'pending' };
  await db.runAsync(
    `INSERT INTO local_sessions (id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [session.id, JSON.stringify(payload), new Date().toISOString()],
  );
  await clearDraft(session.id);
}

export async function listQueuedSessions(): Promise<LocalSession[]> {
  await ensureSessionTable();
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM local_sessions ORDER BY updated_at DESC LIMIT 50',
  );
  return rows.map((r) => JSON.parse(r.json) as LocalSession);
}

export async function markSessionSynced(
  sessionId: string,
  patch?: Partial<LocalSession>,
): Promise<void> {
  await ensureSessionTable();
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM local_sessions WHERE id = ?',
    [sessionId],
  );
  if (!row) return;
  const session = {
    ...(JSON.parse(row.json) as LocalSession),
    ...patch,
    syncStatus: 'synced' as const,
  };
  await db.runAsync(
    'UPDATE local_sessions SET json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(session), new Date().toISOString(), sessionId],
  );
}

export async function markSessionError(
  sessionId: string,
  error: string,
): Promise<void> {
  await ensureSessionTable();
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM local_sessions WHERE id = ?',
    [sessionId],
  );
  if (!row) return;
  const session = {
    ...(JSON.parse(row.json) as LocalSession),
    syncStatus: 'error' as const,
    lastError: error,
  };
  await db.runAsync(
    'UPDATE local_sessions SET json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(session), new Date().toISOString(), sessionId],
  );
}

/** Best-effort upload of a session photo (E0-S04 + E4-S08). Offline → pending key. */
export async function uploadSessionPhoto(
  localUri: string,
): Promise<{ storageKey: string; offline: boolean }> {
  try {
    const signed = await apiFetch<{ url: string; key: string }>(
      '/uploads/sign',
      {
        method: 'POST',
        body: { category: 'session-photo', contentType: 'image/jpeg' },
      },
    );
    const blob = await (await fetch(localUri)).blob();
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    return { storageKey: signed.key, offline: false };
  } catch {
    const key = `pending-upload/session-photo/${await Crypto.randomUUID()}`;
    await kvSet(`upload.queue.${key}`, localUri);
    return { storageKey: key, offline: true };
  }
}

/**
 * E4-S16 + E5: queue locally, then drain via the sync engine (compression,
 * resumable uploads, backoff). Idempotent when already on the server.
 */
export async function saveAndSyncSession(
  session: LocalSession,
): Promise<{ synced: boolean; server?: ServerSession; error?: string }> {
  await enqueueSession(session);
  // Dynamic import avoids a circular dep (sync → capture).
  const { runSyncPass } = await import('./sync');
  const result = await runSyncPass({ notify: true });
  try {
    const server = await apiFetch<ServerSession>(`/sessions/${session.id}`);
    if (server.photos.length > 0) {
      return { synced: true, server };
    }
  } catch {
    /* still offline */
  }
  const queued = (await listQueuedSessions()).find((s) => s.id === session.id);
  if (queued?.syncStatus === 'synced') {
    return { synced: true };
  }
  return {
    synced: false,
    error:
      queued?.lastError ??
      (result.failed > 0
        ? 'Sync deferred — will retry when online'
        : '1 session pending sync'),
  };
}

export async function fetchRoster(siteId?: string): Promise<WorkerDto[]> {
  const q = siteId
    ? `/workers?pageSize=200&siteId=${siteId}`
    : '/workers?pageSize=200';
  try {
    const page = await apiFetch<{ items: WorkerDto[] }>(q);
    await kvSet(
      siteId ? `capture.roster.${siteId}` : 'capture.roster',
      JSON.stringify(page.items),
    );
    return page.items.filter((w) => w.status === 'active');
  } catch {
    const cached = await kvGet(
      siteId ? `capture.roster.${siteId}` : 'capture.roster',
    );
    if (!cached) return [];
    return (JSON.parse(cached) as WorkerDto[]).filter(
      (w) => w.status === 'active',
    );
  }
}

export async function applyServerTagAction(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<ServerSession> {
  return apiFetch<ServerSession>(`/sessions/${sessionId}/tags`, {
    method: 'POST',
    body,
  });
}

export async function fetchReconciliation(
  sessionId: string,
): Promise<{ workerId: string; fullName: string }[]> {
  return apiFetch(`/sessions/${sessionId}/reconciliation`);
}

export async function postReconciliation(
  sessionId: string,
  workerId: string,
  action: 'left_early' | 'leave_exception',
  note?: string,
): Promise<void> {
  await apiFetch(`/sessions/${sessionId}/reconciliation`, {
    method: 'POST',
    body: { workerId, action, note },
  });
}

export function summaryCounts(session: LocalSession, server?: ServerSession) {
  if (server) {
    const active = server.tags.filter((t) => t.status === 'active');
    return {
      tagged: active.filter(
        (t) => t.workerId && t.source !== 'visitor' && t.source !== 'manual',
      ).length,
      manual: active.filter((t) => t.source === 'manual').length,
      visitor: active.filter((t) => t.source === 'visitor').length,
      confirmPending: server.tags.filter((t) => t.status === 'pending_confirm')
        .length,
    };
  }
  return {
    tagged: 0,
    manual: session.localTags.filter((t) => t.source === 'manual').length,
    visitor: session.localTags.filter((t) => t.source === 'visitor').length,
    confirmPending: 0,
  };
}
