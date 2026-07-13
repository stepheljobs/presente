import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
  fetchReconciliation,
  listQueuedSessions,
  loadDraft,
  postReconciliation,
  saveAndSyncSession,
  summaryCounts,
  type LocalSession,
  type ServerSession,
} from '../../lib/capture';
import { apiFetch } from '../../lib/api';

import { Screen } from '../../components/Screen';
/**
 * E4-S16 + S18: session summary (counts, geofence, time) and optional
 * time-out reconciliation strip. Save persists to the encrypted queue.
 */
export default function SummaryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [server, setServer] = useState<ServerSession | null>(null);
  const [missing, setMissing] = useState<
    { workerId: string; fullName: string }[]
  >([]);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      let draft = await loadDraft(sessionId);
      if (!draft) {
        // May already be enqueued from the tag screen sync path.
        const queued = await listQueuedSessions();
        draft = queued.find((s) => s.id === sessionId) ?? null;
      }
      if (!draft) {
        setError('Session not found');
        return;
      }
      setSession(draft);

      if (draft.syncStatus === 'synced') {
        try {
          const s = await apiFetch<ServerSession>(`/sessions/${draft.id}`);
          setServer(s);
          if (draft.type === 'time_out') {
            setMissing(await fetchReconciliation(draft.id));
          }
        } catch {
          /* offline — local summary still works */
        }
      }
    })();
  }, [sessionId]);

  async function onSave() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      if (session.syncStatus !== 'synced') {
        const result = await saveAndSyncSession(session);
        if (result.server) {
          setServer(result.server);
          setStatusLine('Synced ✓');
          if (session.type === 'time_out') {
            setMissing(await fetchReconciliation(session.id));
          }
        } else {
          setStatusLine(
            result.error
              ? `Queued — ${result.error}`
              : '1 session pending sync',
          );
        }
      } else {
        setStatusLine('Already synced ✓');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(
    workerId: string,
    action: 'left_early' | 'leave_exception',
  ) {
    if (!session) return;
    if (action === 'left_early' && !note.trim()) {
      setNoteFor(workerId);
      return;
    }
    setBusy(true);
    try {
      await postReconciliation(
        session.id,
        workerId,
        action,
        action === 'left_early' ? note.trim() : undefined,
      );
      setMissing((m) => m.filter((w) => w.workerId !== workerId));
      setNoteFor(null);
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setBusy(false);
    }
  }

  if (!session && !error) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <ActivityIndicator color="#14532d" />
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <Text style={styles.error}>{error}</Text>
      </Screen>
    );
  }

  const counts = summaryCounts(session, server ?? undefined);
  const time = new Date(session.deviceCapturedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fence =
    session.gps.status === 'no_fix'
      ? 'GPS unavailable'
      : session.gps.withinFence
        ? 'GPS ✓ inside geofence'
        : `GPS ⚠ ${session.gps.distanceM ?? '?'} m outside`;

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      <Text style={styles.heading}>Session summary</Text>
      <Text style={styles.line}>
        {session.type === 'time_in' ? 'Time In' : 'Time Out'} ·{' '}
        {session.siteName}
      </Text>
      <Text style={styles.line}>
        {counts.tagged} tagged · {counts.manual} manual · {counts.visitor}{' '}
        visitor
        {counts.confirmPending > 0
          ? ` · ${counts.confirmPending} to confirm`
          : ''}
      </Text>
      <Text style={styles.line}>
        {fence} · {time}
      </Text>
      {session.gps.mockLocation && (
        <Text style={styles.warn}>Mock location flagged</Text>
      )}
      <Text style={styles.meta}>
        {session.photos.length} photo
        {session.photos.length === 1 ? '' : 's'} · device {session.deviceId}
      </Text>

      {session.type === 'time_out' && missing.length > 0 && (
        <View style={styles.recon}>
          <Text style={styles.reconTitle}>
            ⚠ {missing.length} worker
            {missing.length === 1 ? '' : 's'} timed-in this morning not in
            these photos
          </Text>
          <FlatList
            data={missing}
            keyExtractor={(w) => w.workerId}
            renderItem={({ item }) => (
              <View style={styles.reconRow}>
                <Text style={styles.name}>{item.fullName}</Text>
                {noteFor === item.workerId ? (
                  <View style={{ gap: 6 }}>
                    <TextInput
                      style={styles.input}
                      placeholder="Left early — note required"
                      value={note}
                      onChangeText={setNote}
                    />
                    <Pressable
                      style={styles.smallBtn}
                      onPress={() => void reconcile(item.workerId, 'left_early')}
                    >
                      <Text style={styles.smallBtnText}>Save note</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.reconActions}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/capture/camera',
                          params: { sessionId: session.id },
                        })
                      }
                    >
                      <Text style={styles.link}>Capture again</Text>
                    </Pressable>
                    <Pressable onPress={() => setNoteFor(item.workerId)}>
                      <Text style={styles.link}>Left early</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void reconcile(item.workerId, 'leave_exception')
                      }
                    >
                      <Text style={styles.link}>Leave as exception</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          />
        </View>
      )}

      {statusLine && <Text style={styles.status}>{statusLine}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {!done ? (
        <Pressable
          style={[styles.button, busy && styles.disabled]}
          disabled={busy}
          onPress={() => void onSave()}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Saving…' : 'Save session'}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.button}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.buttonText}>Done — back to Home</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: '#14532d' },
  line: { fontSize: 16 },
  meta: { color: '#666', fontSize: 13 },
  warn: { color: '#b45309', fontWeight: '600' },
  status: {
    backgroundColor: '#ecfdf5',
    color: '#14532d',
    padding: 10,
    borderRadius: 6,
    fontWeight: '600',
  },
  recon: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    maxHeight: 280,
  },
  reconTitle: { fontWeight: '700', color: '#92400e' },
  reconRow: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#fcd34d' },
  reconActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  name: { fontWeight: '600' },
  link: { color: '#14532d', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#fff',
  },
  smallBtn: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  smallBtnText: { color: '#fff', fontWeight: '600' },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#b91c1c' },
  disabled: { opacity: 0.5 },
});
