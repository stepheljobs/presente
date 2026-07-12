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
import {
  listQueuedSessions,
  type LocalSession,
} from '../../lib/capture';
import { useSync } from '../../lib/sync-context';

/** Local session queue — E4-S16 + E5-S01/S02 detail surface. */
export default function AttendanceScreen() {
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { syncNow, pill } = useSync();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSessions(await listQueuedSessions());
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
      <View style={styles.row}>
        <Pressable
          style={styles.btn}
          onPress={() =>
            router.push({ pathname: '/capture/site', params: { type: 'time_in' } })
          }
        >
          <Text style={styles.btnText}>Time In</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnOut]}
          onPress={() =>
            router.push({
              pathname: '/capture/site',
              params: { type: 'time_out' },
            })
          }
        >
          <Text style={styles.btnText}>Time Out</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable
          style={[styles.syncBtn, { flex: 1 }]}
          onPress={async () => {
            await syncNow();
            await refresh();
          }}
        >
          <Text style={styles.syncBtnText}>
            {pill.kind === 'uploading' ? 'Syncing…' : 'Sync now'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.syncBtn, { flex: 1 }]}
          onPress={() => router.push('/corrections')}
        >
          <Text style={styles.syncBtnText}>Corrections</Text>
        </Pressable>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No sessions on this device yet. Start a Time In from Home.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>
              {item.type === 'time_in' ? 'Time In' : 'Time Out'} · {item.siteName}
            </Text>
            <Text style={styles.meta}>
              {new Date(item.deviceCapturedAt).toLocaleString()} ·{' '}
              {item.photos.length} photo{item.photos.length === 1 ? '' : 's'}
            </Text>
            <Text
              style={[
                styles.status,
                item.syncStatus === 'synced' && styles.synced,
                item.syncStatus === 'error' && styles.err,
                item.syncStatus === 'pending' && styles.pending,
              ]}
            >
              {statusLabel(item)}
              {item.lastError ? ` — ${item.lastError}` : ''}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function statusLabel(s: LocalSession): string {
  switch (s.syncStatus) {
    case 'pending':
      return 'pending';
    case 'synced':
      return 'synced';
    case 'error':
      return 'needs attention';
    case 'draft':
      return 'draft';
    default:
      return s.syncStatus;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  btnOut: { backgroundColor: '#1e3a5f' },
  btnText: { color: '#fff', fontWeight: '700' },
  syncBtn: {
    borderWidth: 1,
    borderColor: '#14532d',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  syncBtnText: { color: '#14532d', fontWeight: '600' },
  empty: { color: '#666', textAlign: 'center', marginTop: 40 },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  title: { fontWeight: '600', fontSize: 15 },
  meta: { color: '#666', fontSize: 13 },
  status: { fontSize: 12, fontWeight: '600', color: '#666' },
  synced: { color: '#14532d' },
  pending: { color: '#b45309' },
  err: { color: '#b91c1c' },
});
