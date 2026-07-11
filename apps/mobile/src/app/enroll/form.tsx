import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { apiFetch } from '../../lib/api';
import {
  EnrollmentDraft,
  loadDraft,
  saveDraft,
} from '../../lib/enrollment';

/**
 * E3-S02: worker profile form. No rate field — engineers cannot see or
 * set rates (the admin confirms one at approval, E3-S10). Draft persists
 * to the encrypted DB on every keystroke.
 */
export default function WorkerFormScreen() {
  const [draft, setDraft] = useState<EnrollmentDraft>({ fullName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    loadDraft().then((saved) => {
      if (saved?.fullName) {
        setDraft(saved);
        setRestored(true);
      }
    });
  }, []);

  function patch(update: Partial<EnrollmentDraft>) {
    const next = { ...draft, ...update };
    setDraft(next);
    void saveDraft(next);
  }

  async function onNext() {
    setError(null);
    setBusy(true);
    try {
      const worker = await apiFetch<{ id: string }>('/workers', {
        method: 'POST',
        body: {
          fullName: draft.fullName.trim(),
          nickname: draft.nickname?.trim() || undefined,
          position: draft.position?.trim() || undefined,
          phone: draft.phone?.trim() || undefined,
          startDate: draft.startDate || undefined,
        },
      });
      await saveDraft({ ...draft, workerId: worker.id });
      router.push('/enroll/consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save worker');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>New worker</Text>
      {restored && (
        <Text style={styles.restored}>Draft restored from this device.</Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="Full name *"
        value={draft.fullName}
        onChangeText={(fullName) => patch({ fullName })}
      />
      <TextInput
        style={styles.input}
        placeholder="Nickname"
        value={draft.nickname ?? ''}
        onChangeText={(nickname) => patch({ nickname })}
      />
      <TextInput
        style={styles.input}
        placeholder="Position (e.g. Mason)"
        value={draft.position ?? ''}
        onChangeText={(position) => patch({ position })}
      />
      <TextInput
        style={styles.input}
        placeholder="Phone (optional)"
        keyboardType="phone-pad"
        value={draft.phone ?? ''}
        onChangeText={(phone) => patch({ phone })}
      />
      <TextInput
        style={styles.input}
        placeholder="Start date YYYY-MM-DD (optional)"
        value={draft.startDate ?? ''}
        onChangeText={(startDate) => patch({ startDate })}
      />
      <Text style={styles.note}>
        Daily rate is set by your admin when they approve this worker.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, (busy || draft.fullName.trim().length < 2) && styles.disabled]}
        disabled={busy || draft.fullName.trim().length < 2}
        onPress={onNext}
      >
        <Text style={styles.buttonText}>
          {busy ? 'Saving…' : 'Next: consent'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10 },
  title: { fontSize: 24, fontWeight: '700' },
  restored: { color: '#14532d', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
  },
  note: { color: '#666', fontSize: 13 },
  error: { color: '#b91c1c' },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
