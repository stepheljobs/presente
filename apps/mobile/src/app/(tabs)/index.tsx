import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../lib/auth-context';
import { kvGet, kvSet } from '../../lib/db';

/**
 * Home also doubles as the E0-S09 acceptance probe: first launch writes a
 * record into the encrypted DB; every later launch (including after app
 * restart) reads it back, proving persistence through the SQLCipher store.
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const [firstLaunch, setFirstLaunch] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let v = await kvGet('firstLaunchAt');
        if (!v) {
          v = new Date().toISOString();
          await kvSet('firstLaunchAt', v);
        }
        setFirstLaunch(v);
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
      <Text style={styles.hint}>
        Time In / Time Out entry points land here with E4.
      </Text>
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
  container: { flex: 1, padding: 24, gap: 10 },
  heading: { fontSize: 18, fontWeight: '600' },
  role: { color: '#14532d' },
  hint: { color: '#666' },
  meta: { color: '#999', fontSize: 12 },
  error: { color: '#b91c1c' },
  signOut: { marginTop: 'auto', alignSelf: 'flex-start' },
  signOutText: { color: '#b91c1c', fontSize: 16 },
});
