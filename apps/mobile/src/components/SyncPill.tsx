import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSync } from '../lib/sync-context';
import type { SyncPillState } from '../lib/sync';

/** E5-S02: persistent pill on engineer screens; tap → queue detail. */
export function SyncPill() {
  const { pill, syncNow } = useSync();
  if (pill.kind === 'idle') return null;

  const label = labelFor(pill);
  const tone =
    pill.kind === 'attention'
      ? styles.attention
      : pill.kind === 'uploading'
        ? styles.uploading
        : pill.kind === 'synced'
          ? styles.synced
          : styles.pending;

  return (
    <Pressable
      style={[styles.pill, tone]}
      onPress={() => {
        if (pill.kind === 'pending' || pill.kind === 'attention') {
          void syncNow();
        }
        router.push('/(tabs)/attendance');
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

function labelFor(pill: SyncPillState): string {
  switch (pill.kind) {
    case 'pending':
      return `${pill.count} session${pill.count === 1 ? '' : 's'} pending sync`;
    case 'uploading':
      return `Uploading${pill.count ? ` (${pill.count})` : '…'}`;
    case 'attention':
      return `${pill.count} need${pill.count === 1 ? 's' : ''} attention`;
    case 'synced':
      return 'All sessions synced ✓';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  pending: { backgroundColor: '#fef3c7' },
  uploading: { backgroundColor: '#dbeafe' },
  attention: { backgroundColor: '#fee2e2' },
  synced: { backgroundColor: '#dcfce7' },
  text: { fontWeight: '600', fontSize: 13, color: '#1f2937' },
});
