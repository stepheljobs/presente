import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { apiFetch } from '../../lib/api';

import { Screen } from '../../components/Screen';
interface WorkerDetail {
  id: string;
  fullName: string;
  nickname: string | null;
  position: string | null;
  status: string;
  siteIds: string[];
}

interface Site {
  id: string;
  name: string;
  client: string | null;
  address: string | null;
  archived: boolean;
}

/**
 * Assign a worker to site rosters (field reassignment).
 * POST/DELETE /sites/:siteId/workers/:workerId
 */
export default function AssignSitesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [worker, setWorker] = useState<WorkerDetail | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, siteList] = await Promise.all([
        apiFetch<WorkerDetail>(`/workers/${id}`),
        apiFetch<Site[]>('/sites'),
      ]);
      setWorker(w);
      setSites(siteList.filter((s) => !s.archived));
      setSelected(new Set(w.siteIds ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleSite(site: Site, on: boolean) {
    if (!worker || busyId) return;
    setBusyId(site.id);
    setError(null);
    const prev = new Set(selected);
    const next = new Set(selected);
    if (on) next.add(site.id);
    else next.delete(site.id);
    setSelected(next);
    try {
      if (on) {
        await apiFetch(`/sites/${site.id}/workers/${worker.id}`, {
          method: 'POST',
        });
      } else {
        await apiFetch(`/sites/${site.id}/workers/${worker.id}`, {
          method: 'DELETE',
        });
      }
    } catch (err) {
      setSelected(prev);
      setError(err instanceof Error ? err.message : 'Could not update roster');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <ActivityIndicator size="large" color="#14532d" />
      </Screen>
    );
  }

  if (!worker) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <Text style={styles.error}>{error ?? 'Worker not found'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      <Text style={styles.heading}>{worker.fullName}</Text>
      <Text style={styles.meta}>
        {[worker.nickname ? `“${worker.nickname}”` : null, worker.position]
          .filter(Boolean)
          .join(' · ') || '—'}
        {worker.status !== 'active' ? ` · ${worker.status}` : ''}
      </Text>
      <Text style={styles.hint}>
        Toggle sites this worker is on. Capture “Tag from roster” only shows
        workers assigned to the selected site.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={sites}
        keyExtractor={(s) => s.id}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No sites available. Create a site on the web dashboard (or ask an
            admin to assign you to a site if you are an engineer).
          </Text>
        }
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          const busy = busyId === item.id;
          return (
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{item.name}</Text>
                {item.address ? (
                  <Text style={styles.meta}>{item.address}</Text>
                ) : item.client ? (
                  <Text style={styles.meta}>{item.client}</Text>
                ) : null}
              </View>
              <Switch
                value={on}
                disabled={busy || worker.status === 'deactivated'}
                onValueChange={(value) => void toggleSite(item, value)}
                trackColor={{ true: '#86efac', false: '#d1d5db' }}
                thumbColor={on ? '#14532d' : '#f4f4f5'}
              />
            </View>
          );
        }}
      />

      <Pressable style={styles.done} onPress={() => router.back()}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  heading: { fontSize: 20, fontWeight: '700', color: '#14532d' },
  meta: { color: '#666', fontSize: 13 },
  hint: { color: '#666', fontSize: 14, lineHeight: 20 },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowMain: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  empty: { color: '#666', textAlign: 'center', marginTop: 32, lineHeight: 20 },
  error: { color: '#b91c1c' },
  link: { color: '#14532d', fontWeight: '600' },
  done: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
