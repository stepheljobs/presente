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
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.name}>{item.fullName}</Text>
              <Text style={styles.meta}>
                {item.position ?? '—'} · face: {item.biometricStatus}
              </Text>
            </View>
            {item.status === 'pending_approval' && (
              <Text style={styles.pending}>awaiting approval</Text>
            )}
          </View>
        )}
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
  error: { color: '#b91c1c' },
  empty: { color: '#666', textAlign: 'center', marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 13 },
  pending: { color: '#946200', fontSize: 12, fontWeight: '600' },
});
