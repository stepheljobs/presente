import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  applyServerTagAction,
  fetchRoster,
  loadDraft,
  saveAndSyncSession,
  saveDraft,
  type LocalSession,
  type LocalTag,
  type ServerSession,
  type ServerTag,
  type WorkerDto,
} from '../../lib/capture';
import { hasPendingRecognition } from '../../lib/sync';

/**
 * E4-S11–S15: tagging screen — auto chips (after sync), confirm cards,
 * manual roster tag, visitor mark, quick-enroll entry.
 *
 * Cloud recognition runs at sync (PRD §7). Offline, the engineer tags
 * manually against the cached roster; local decisions ride with the queue.
 */
export default function TagScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [roster, setRoster] = useState<WorkerDto[]>([]);
  const [server, setServer] = useState<ServerSession | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'manual' | 'confirm'>('list');
  const [confirmTag, setConfirmTag] = useState<ServerTag | null>(null);

  useEffect(() => {
    void (async () => {
      const draft = await loadDraft(sessionId);
      if (!draft) {
        setError('Session draft missing');
        return;
      }
      setSession(draft);
      setRoster(await fetchRoster(draft.siteId));
    })();
  }, [sessionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (w) =>
        w.fullName.toLowerCase().includes(q) ||
        (w.nickname?.toLowerCase().includes(q) ?? false),
    );
  }, [roster, query]);

  const autoTags =
    server?.tags.filter(
      (t) => t.band === 'high' && t.status === 'active' && t.workerId,
    ) ?? [];
  const confirmTags =
    server?.tags.filter(
      (t) => t.band === 'confirm' && t.status === 'pending_confirm',
    ) ?? [];
  const unrecognized =
    server?.tags.filter(
      (t) => t.band === 'unrecognized' && t.status === 'pending_confirm',
    ) ?? [];

  async function tryCloudPass() {
    if (!session) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await saveAndSyncSession(session);
      if (result.server) {
        setServer(result.server);
        setSession({ ...session, syncStatus: 'synced' });
      } else if (!result.synced) {
        setError(
          result.error ??
            'Offline — tag manually from roster; session is queued',
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  async function addManual(worker: WorkerDto) {
    if (!session) return;
    // "Pick other" from a confirm card: reject the auto match and land a
    // flagged manual tag for the chosen worker (E4-S12/S13).
    if (server && confirmTag) {
      setBusy(true);
      try {
        const next = await applyServerTagAction(session.id, {
          type: 'confirm',
          tagId: confirmTag.id,
          accept: false,
          workerId: worker.id,
        });
        setServer(next);
        setConfirmTag(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Tag failed');
      } finally {
        setBusy(false);
      }
      setMode('list');
      setQuery('');
      return;
    }

    const tag: LocalTag = {
      id: await randomUUID(),
      workerId: worker.id,
      workerName: worker.fullName,
      source: 'manual',
    };
    if (server) {
      setBusy(true);
      try {
        const next = await applyServerTagAction(session.id, {
          type: 'manual',
          workerId: worker.id,
        });
        setServer(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Tag failed');
      } finally {
        setBusy(false);
      }
    } else {
      const next = {
        ...session,
        localTags: [...session.localTags, tag],
      };
      setSession(next);
      await saveDraft(next);
    }
    setMode('list');
    setQuery('');
  }

  async function addVisitor() {
    if (!session) return;
    if (server) {
      setBusy(true);
      try {
        const next = await applyServerTagAction(session.id, { type: 'visitor' });
        setServer(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Visitor mark failed');
      } finally {
        setBusy(false);
      }
    } else {
      const tag: LocalTag = {
        id: await randomUUID(),
        source: 'visitor',
      };
      const next = {
        ...session,
        localTags: [...session.localTags, tag],
      };
      setSession(next);
      await saveDraft(next);
    }
  }

  async function onConfirm(accept: boolean, otherWorkerId?: string) {
    if (!session || !confirmTag) return;
    setBusy(true);
    try {
      const next = await applyServerTagAction(session.id, {
        type: 'confirm',
        tagId: confirmTag.id,
        accept,
        workerId: otherWorkerId,
      });
      setServer(next);
      setConfirmTag(null);
      setMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function goSummary() {
    if (!session) return;
    // Ensure local tags are saved even if we never synced.
    await saveDraft(session);
    router.push({
      pathname: '/capture/summary',
      params: { sessionId: session.id },
    });
  }

  if (!session) {
    return (
      <View style={styles.center}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color="#14532d" />
        )}
      </View>
    );
  }

  if (mode === 'manual') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Tag from roster</Text>
        <Text style={styles.hint}>
          Manual tags are flagged for admin review (FR-15).
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Search name…"
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        <FlatList
          data={filtered}
          keyExtractor={(w) => w.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              disabled={busy}
              onPress={() => void addManual(item)}
            >
              <Text style={styles.name}>{item.fullName}</Text>
              {item.nickname ? (
                <Text style={styles.meta}>{item.nickname}</Text>
              ) : null}
            </Pressable>
          )}
        />
        <Pressable style={styles.secondary} onPress={() => setMode('list')}>
          <Text>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'confirm' && confirmTag) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Is this {confirmTag.workerName}?</Text>
        <Text style={styles.hint}>
          Confidence{' '}
          {confirmTag.confidence != null
            ? `${Math.round(confirmTag.confidence * 100)}%`
            : '—'}
          {confirmTag.notice?.forcedConfirm
            ? ' · lookalike pair — confirm required'
            : ''}
        </Text>
        <View style={styles.confirmActions}>
          <Pressable
            style={[styles.button, styles.yes]}
            disabled={busy}
            onPress={() => void onConfirm(true)}
          >
            <Text style={styles.buttonText}>Yes</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.no]}
            disabled={busy}
            onPress={() => void onConfirm(false)}
          >
            <Text style={styles.buttonText}>No</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            disabled={busy}
            onPress={() => {
              setMode('manual');
              // "Pick other" → reject then manual; store tag for reject+pick.
              setConfirmTag(confirmTag);
            }}
          >
            <Text>Pick other…</Text>
          </Pressable>
        </View>
        {mode === 'confirm' && (
          <Pressable
            style={styles.secondary}
            onPress={() => {
              setConfirmTag(null);
              setMode('list');
            }}
          >
            <Text>Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {session.siteName} ·{' '}
        {session.type === 'time_in' ? 'Time In' : 'Time Out'}
      </Text>
      <Text style={styles.meta}>
        {session.photos.length} photo
        {session.photos.length === 1 ? '' : 's'} ·{' '}
        {server
          ? hasPendingRecognition(server)
            ? 'pending recognition'
            : 'recognition done'
          : 'not yet synced'}
      </Text>

      {/* E5-S07: offline / pre-cloud faces show pending-recognition chips. */}
      {(!server || hasPendingRecognition(server)) && (
        <View style={styles.chips}>
          {session.photos.map((p) => (
            <View key={p.id} style={styles.chipPending}>
              <Text style={styles.chipText}>pending recognition</Text>
            </View>
          ))}
        </View>
      )}

      {!server && (
        <Pressable
          style={[styles.button, syncing && styles.disabled]}
          disabled={syncing}
          onPress={() => void tryCloudPass()}
        >
          <Text style={styles.buttonText}>
            {syncing ? 'Syncing / recognizing…' : 'Sync & run recognition'}
          </Text>
        </Pressable>
      )}

      {autoTags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Auto-tagged</Text>
          <View style={styles.chips}>
            {autoTags.map((t) => (
              <View key={t.id} style={styles.chipGreen}>
                <Text style={styles.chipText}>
                  {t.workerName ?? t.nickname} ✓
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {confirmTags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Confirm</Text>
          {confirmTags.map((t) => (
            <Pressable
              key={t.id}
              style={styles.confirmCard}
              onPress={() => {
                setConfirmTag(t);
                setMode('confirm');
              }}
            >
              <Text style={styles.name}>
                Is this {t.workerName ?? 'unknown'}?
              </Text>
              <Text style={styles.meta}>Tap to answer</Text>
            </Pressable>
          ))}
        </View>
      )}

      {unrecognized.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Unrecognized ({unrecognized.length})
          </Text>
          <Text style={styles.hint}>Tag from roster or mark as visitor.</Text>
        </View>
      )}

      {session.localTags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Local tags (queued)</Text>
          <View style={styles.chips}>
            {session.localTags.map((t) => (
              <View
                key={t.id}
                style={
                  t.source === 'visitor' ? styles.chipGray : styles.chipAmber
                }
              >
                <Text style={styles.chipText}>
                  {t.source === 'visitor'
                    ? 'Visitor'
                    : `${t.workerName} (manual)`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={() => setMode('manual')}>
          <Text style={styles.actionText}>Tag from roster</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => void addVisitor()}>
          <Text style={styles.actionText}>Mark visitor</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() =>
            router.push({
              pathname: '/enroll/form',
              params: { fromSession: session.id },
            })
          }
        >
          <Text style={styles.actionText}>Quick-enroll new hire</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (busy || syncing) && styles.disabled]}
        disabled={busy || syncing}
        onPress={() => void goSummary()}
      >
        <Text style={styles.buttonText}>Review & save</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 18, fontWeight: '700' },
  section: { gap: 6 },
  sectionTitle: { fontWeight: '700', color: '#14532d' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipGreen: {
    backgroundColor: '#dcfce7',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipAmber: {
    backgroundColor: '#fef3c7',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipGray: {
    backgroundColor: '#e5e7eb',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipPending: {
    backgroundColor: '#e0e7ff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontWeight: '600', fontSize: 13 },
  confirmCard: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 12,
  },
  confirmActions: { gap: 10, marginTop: 12 },
  yes: { backgroundColor: '#14532d' },
  no: { backgroundColor: '#991b1b' },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 13 },
  hint: { color: '#666' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#14532d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionText: { color: '#14532d', fontWeight: '600' },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 'auto',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { padding: 12, alignItems: 'center' },
  error: { color: '#b91c1c' },
  disabled: { opacity: 0.5 },
});
