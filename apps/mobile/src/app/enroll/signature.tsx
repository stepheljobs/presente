import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import type { ViewShotRef } from 'react-native-view-shot';
import { apiFetch } from '../../lib/api';
import { loadDraft, uploadArtifact } from '../../lib/enrollment';

import { Screen } from '../../components/Screen';
type Stroke = { x: number; y: number }[];

/**
 * E3-S04: on-screen signature pad. Stroke data (raw points) and the
 * rendered PNG are both stored with the consent record.
 */
export default function SignatureScreen() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shotRef = useRef<ViewShotRef>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        setStrokes((s) => [...s, [{ x: locationX, y: locationY }]]);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        setStrokes((s) => {
          const next = [...s];
          next[next.length - 1] = [
            ...next[next.length - 1],
            { x: locationX, y: locationY },
          ];
          return next;
        });
      },
    }),
  ).current;

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      const draft = await loadDraft();
      if (!draft?.workerId) throw new Error('Worker draft missing');
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error('Could not render signature');
      const artifactKey = await uploadArtifact(uri, 'consent', 'image/png');
      await apiFetch(`/workers/${draft.workerId}/consents`, {
        method: 'POST',
        body: {
          type: 'signature',
          artifactKey,
          strokeData: { strokes },
          language: draft.consentLanguage ?? 'tl',
        },
      });
      router.push('/enroll/faces');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save consent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      <Text style={styles.title}>Worker signature</Text>
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', result: 'tmpfile' }}
        style={styles.padWrap}
      >
        <View style={styles.pad} {...panResponder.panHandlers}>
          <Svg style={StyleSheet.absoluteFill}>
            {strokes.map((stroke, i) => (
              <Polyline
                key={i}
                points={stroke.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#111"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
          {strokes.length === 0 && (
            <Text style={styles.placeholder}>Sign here / Pumirma dito</Text>
          )}
        </View>
      </ViewShot>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.row}>
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => setStrokes([])}
        >
          <Text style={styles.buttonSecondaryText}>Clear</Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            (strokes.length === 0 || busy) && styles.disabled,
          ]}
          disabled={strokes.length === 0 || busy}
          onPress={onSave}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Saving…' : 'Save consent'}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  padWrap: { flex: 1 },
  pad: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: { color: '#bbb', fontSize: 18 },
  row: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    padding: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: '#333' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c' },
});
