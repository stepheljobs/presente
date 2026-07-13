import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { apiFetch } from '../../lib/api';
import type { WorkerDto } from '../../lib/capture';
import { fetchRoster } from '../../lib/capture';
/**
 * E6-S05: engineer correction request — proposed change + reason.
 * Queues via API when online; caller can retry when offline later.
 */
export default function NewCorrectionScreen() {
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<WorkerDto[]>([]);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('halfday');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void fetchRoster().then(setWorkers);
  }, []);

  async function submit() {
    if (!workerId || reason.trim().length < 3) {
      setError('Pick a worker and enter a reason');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/corrections', {
        method: 'POST',
        body: {
          workerId,
          day,
          proposed: { status },
          reason: reason.trim(),
        },
      });
      setDone(true);
    } catch (err) {
      // Offline: stash for later (E5 queue pattern).
      const { kvSet } = await import('../../lib/db');
      const id = `offline-corr-${Date.now()}`;
      await kvSet(
        `correction.queue.${id}`,
        JSON.stringify({
          workerId,
          day,
          proposed: { status },
          reason: reason.trim(),
        }),
      );
      setError(
        err instanceof Error
          ? `${err.message} — saved offline for sync`
          : 'Saved offline for sync',
      );
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done && !error) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <Text style={styles.title}>Submitted ✓</Text>
        <Text style={styles.meta}>Admin will review your request.</Text>
        <Pressable style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 12) + 16 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Request correction</Text>
      <Text style={styles.label}>Day (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={day} onChangeText={setDay} />
      <Text style={styles.label}>Worker</Text>
      {workers.map((w) => (
        <Pressable
          key={w.id}
          style={[styles.row, workerId === w.id && styles.rowActive]}
          onPress={() => setWorkerId(w.id)}
        >
          <Text>{w.fullName}</Text>
        </Pressable>
      ))}
      <Text style={styles.label}>Proposed status</Text>
      {(['present', 'halfday', 'absent'] as const).map((s) => (
        <Pressable
          key={s}
          style={[styles.row, status === s && styles.rowActive]}
          onPress={() => setStatus(s)}
        >
          <Text>{s}</Text>
        </Pressable>
      ))}
      <Text style={styles.label}>Reason</Text>
      <TextInput
        style={[styles.input, styles.area]}
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="What should change and why?"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.btn, busy && styles.disabled]}
        disabled={busy}
        onPress={() => void submit()}
      >
        <Text style={styles.btnText}>{busy ? 'Submitting…' : 'Submit'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#14532d' },
  label: { fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  area: { minHeight: 80, textAlignVertical: 'top' },
  row: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  rowActive: { borderColor: '#14532d', backgroundColor: '#ecfdf5' },
  btn: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  btnText: { color: '#fff', fontWeight: '700' },
  meta: { color: '#666' },
  error: { color: '#b91c1c' },
  disabled: { opacity: 0.5 },
});
