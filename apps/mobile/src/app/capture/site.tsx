import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  captureGpsFix,
  getDeviceId,
  loadSitesForCapture,
  rememberLastSite,
  saveDraft,
  type GpsFix,
  type SessionType,
  type SiteDto,
} from '../../lib/capture';

/**
 * E4-S01 + S02: site select with GPS pre-selection, then create the local
 * session shell (type, site, engineer device, GPS flags).
 */
export default function SiteSelectScreen() {
  const { type } = useLocalSearchParams<{ type: SessionType }>();
  const sessionType: SessionType = type === 'time_out' ? 'time_out' : 'time_in';

  const [sites, setSites] = useState<SiteDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Provisional fix without a site for nearest lookup.
      const provisional = await captureGpsFix(null);
      setGps(provisional);
      const result = await loadSitesForCapture(provisional);
      setSites(result.sites);
      setSelectedId(result.preselectedId);
      setNote(result.note ?? null);
      setLoading(false);
    })();
  }, []);

  const selected = sites.find((s) => s.id === selectedId) ?? null;

  // Re-evaluate fence once a site is chosen.
  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const fix = await captureGpsFix(selected);
      setGps(fix);
    })();
  }, [selectedId]);

  async function onConfirm() {
    if (!selected) {
      setError('Pick a site to continue');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fix = gps ?? (await captureGpsFix(selected));
      const session = {
        id: await randomUUID(),
        type: sessionType,
        siteId: selected.id,
        siteName: selected.name,
        deviceId: await getDeviceId(),
        deviceCapturedAt: new Date().toISOString(),
        gps: fix,
        photos: [],
        localTags: [],
        syncStatus: 'draft' as const,
      };
      await rememberLastSite(selected.id);
      await saveDraft(session);
      router.push({
        pathname: '/capture/camera',
        params: { sessionId: session.id },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start session');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#14532d" />
        <Text style={styles.hint}>Finding nearest site…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {sessionType === 'time_in' ? 'Time In' : 'Time Out'}
      </Text>
      {note && <Text style={styles.note}>{note}</Text>}
      {gps?.status === 'fix' &&
        gps.withinFence === false &&
        gps.distanceM != null && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              You appear {gps.distanceM} m from site — session will be flagged
            </Text>
          </View>
        )}
      {gps?.mockLocation && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>
            Mock location detected — session will be flagged
          </Text>
        </View>
      )}

      <FlatList
        data={sites}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={
          <Text style={styles.hint}>
            No assigned sites. Ask an admin to assign you to a site.
          </Text>
        }
        renderItem={({ item }) => {
          const active = item.id === selectedId;
          return (
            <Pressable
              style={[styles.row, active && styles.rowActive]}
              onPress={() => setSelectedId(item.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                {item.address ? (
                  <Text style={styles.meta}>{item.address}</Text>
                ) : null}
              </View>
              {item.distanceM != null && (
                <Text style={styles.meta}>
                  {item.distanceM < 1000
                    ? `${item.distanceM} m`
                    : `${(item.distanceM / 1000).toFixed(1)} km`}
                </Text>
              )}
            </Pressable>
          );
        }}
      />

      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, (!selected || busy) && styles.disabled]}
        disabled={!selected || busy}
        onPress={onConfirm}
      >
        <Text style={styles.buttonText}>
          {busy ? 'Starting…' : 'Confirm site'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heading: { fontSize: 22, fontWeight: '700', color: '#14532d' },
  hint: { color: '#666', textAlign: 'center' },
  note: { color: '#92400e', backgroundColor: '#fef3c7', padding: 10, borderRadius: 6 },
  banner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
  bannerWarn: { backgroundColor: '#fee2e2', borderColor: '#ef4444' },
  bannerText: { color: '#78350f', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 8,
  },
  rowActive: { borderColor: '#14532d', backgroundColor: '#ecfdf5' },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#666', fontSize: 13 },
  error: { color: '#b91c1c' },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
