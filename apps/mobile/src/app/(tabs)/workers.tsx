import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch } from '../../lib/api';

interface Worker {
  id: string;
  fullName: string;
  position: string | null;
  status: string;
  biometricStatus: string;
  siteIds?: string[];
}

export default function WorkersScreen() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const page = await apiFetch<{ items: Worker[] }>(
        '/workers?pageSize=200',
      );
      setWorkers(page.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.enrollButton}
        onPress={() => router.push('/enroll/form')}
      >
        <Text style={styles.enrollText}>+ Enroll worker</Text>
      </Pressable>
      <Text style={styles.hint}>
        Tap a worker to assign sites. Capture tagging only lists people on that
        site’s roster.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={workers}
        keyExtractor={(w) => w.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No workers yet — enroll the first one.
          </Text>
        }
        renderItem={({ item }) => {
          const n = item.siteIds?.length ?? 0;
          return (
            <Pressable
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/workers/[id]',
                  params: { id: item.id },
                })
              }
            >
              <View style={styles.rowMain}>
                <Text style={styles.name}>{item.fullName}</Text>
                <Text style={styles.meta}>
                  {item.position ?? '—'} · face: {item.biometricStatus}
                  {` · ${n} site${n === 1 ? '' : 's'}`}
                </Text>
              </View>
              {item.status === 'pending_approval' ? (
                <Text style={styles.pending}>awaiting approval</Text>
              ) : (
                <Text style={styles.chevron}>Assign</Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  enrollButton: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 13,
    alignItems: 'center',
  },
  enrollText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { color: '#666', fontSize: 13, lineHeight: 18 },
  error: { color: '#b91c1c' },
  empty: { color: '#666', textAlign: 'center', marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 10,
  },
  rowMain: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 13 },
  pending: { color: '#946200', fontSize: 12, fontWeight: '600' },
  chevron: { color: '#14532d', fontWeight: '700', fontSize: 13 },
});
