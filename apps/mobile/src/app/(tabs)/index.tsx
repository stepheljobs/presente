import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth-context';
import { listQueuedSessions } from '../../lib/capture';
import { kvGet, kvSet } from '../../lib/db';

/**
 * Home: Time In / Time Out entry points (E4-S02) plus the E0-S09
 * encrypted-store probe and a light sync-status line (E5 polish later).
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const [firstLaunch, setFirstLaunch] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        let v = await kvGet('firstLaunchAt');
        if (!v) {
          v = new Date().toISOString();
          await kvSet('firstLaunchAt', v);
        }
        setFirstLaunch(v);
        const queue = await listQueuedSessions();
        setPending(
          queue.filter((s) => s.syncStatus === 'pending' || s.syncStatus === 'error')
            .length,
        );
      } catch (err) {
        setDbError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {user?.email} · <Text style={styles.role}>{user?.role}</Text>
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.bigBtn, styles.timeIn]}
          onPress={() =>
            router.push({ pathname: '/capture/site', params: { type: 'time_in' } })
          }
        >
          <Text style={styles.bigBtnText}>Time In</Text>
          <Text style={styles.bigBtnSub}>Morning crew photo</Text>
        </Pressable>
        <Pressable
          style={[styles.bigBtn, styles.timeOut]}
          onPress={() =>
            router.push({
              pathname: '/capture/site',
              params: { type: 'time_out' },
            })
          }
        >
          <Text style={styles.bigBtnText}>Time Out</Text>
          <Text style={styles.bigBtnSub}>End-of-day photo</Text>
        </Pressable>
      </View>

      {pending > 0 && (
        <Pressable
          style={styles.pill}
          onPress={() => router.push('/(tabs)/attendance')}
        >
          <Text style={styles.pillText}>
            {pending} session{pending === 1 ? '' : 's'} pending sync
          </Text>
        </Pressable>
      )}

      {firstLaunch && (
        <Text style={styles.meta}>
          Encrypted store initialized {firstLaunch}
        </Text>
      )}
      {dbError && <Text style={styles.error}>Local DB error: {dbError}</Text>}
      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  heading: { fontSize: 18, fontWeight: '600' },
  role: { color: '#14532d' },
  actions: { gap: 12, marginTop: 8 },
  bigBtn: {
    borderRadius: 12,
    padding: 20,
    gap: 4,
  },
  timeIn: { backgroundColor: '#14532d' },
  timeOut: { backgroundColor: '#1e3a5f' },
  bigBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  bigBtnSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { color: '#92400e', fontWeight: '600' },
  meta: { color: '#999', fontSize: 12, marginTop: 8 },
  error: { color: '#b91c1c' },
  signOut: { marginTop: 'auto', alignSelf: 'flex-start' },
  signOutText: { color: '#b91c1c', fontSize: 16 },
});
