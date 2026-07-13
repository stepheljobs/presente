import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch } from '../../lib/api';
import { scheduleLocalNotification } from '../../lib/notifications';

import { Screen } from '../../components/Screen';
interface Correction {
  id: string;
  day: string;
  workerName: string | null;
  reason: string;
  status: string;
  reviewNote: string | null;
}

/**
 * E6-S05/S07: engineer correction list + decision notifications.
 */
export default function CorrectionsListScreen() {
  const [items, setItems] = useState<Correction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Pull open + decided so engineers see outcomes (E6-S07).
      const [open, approved, rejected] = await Promise.all([
        apiFetch<Correction[]>('/corrections?status=submitted'),
        apiFetch<Correction[]>('/corrections?status=approved'),
        apiFetch<Correction[]>('/corrections?status=rejected'),
      ]);
      const decided = [...approved, ...rejected].sort((a, b) =>
        b.day.localeCompare(a.day),
      );
      // Notify once per rejected/approved id we haven't shown.
      for (const c of decided.slice(0, 5)) {
        const key = `corr.notify.${c.id}`;
        // fire-and-forget local notify for newly seen decisions
        void maybeNotify(key, c);
      }
      setItems([...open, ...decided]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      <Pressable
        style={styles.btn}
        onPress={() => router.push('/corrections/new')}
      >
        <Text style={styles.btnText}>+ Request correction</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          <Text style={styles.muted}>No correction requests yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>
              {item.workerName ?? 'Worker'} · {item.day}
            </Text>
            <Text style={styles.meta}>{item.reason}</Text>
            <Text
              style={[
                styles.status,
                item.status === 'approved' && styles.ok,
                item.status === 'rejected' && styles.bad,
              ]}
            >
              {item.status}
              {item.reviewNote ? ` — ${item.reviewNote}` : ''}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

const seen = new Set<string>();
async function maybeNotify(key: string, c: Correction) {
  if (c.status === 'submitted' || seen.has(key)) return;
  seen.add(key);
  await scheduleLocalNotification({
    title:
      c.status === 'approved' ? 'Correction approved' : 'Correction rejected',
    body: `${c.workerName ?? 'Worker'} · ${c.day}${
      c.reviewNote ? ` — ${c.reviewNote}` : ''
    }`,
    data: { path: '/corrections', correctionId: c.id },
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  btn: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  title: { fontWeight: '600' },
  meta: { color: '#666' },
  status: { fontWeight: '600', color: '#b45309' },
  ok: { color: '#14532d' },
  bad: { color: '#b91c1c' },
  muted: { color: '#666', textAlign: 'center', marginTop: 40 },
  error: { color: '#b91c1c' },
});
