import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiFetch } from '../../lib/api';
import {
  clearDraft,
  evaluateShotQuality,
  getQualityConfig,
  loadDraft,
  POSES,
  PoseId,
  uploadArtifact,
} from '../../lib/enrollment';

interface CapturedShot {
  pose: PoseId;
  uri: string;
  sha256: string;
}

/**
 * E3-S07 + S08: guided 4-pose capture (front → left → right → hard hat)
 * with the on-device quality gate. Failing shots prompt an immediate
 * retake with the reason; thresholds come from server config.
 */
export default function FaceCaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [rejection, setRejection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const pose = POSES[shots.length];

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text>Camera access is needed for face enrollment.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  async function onCapture() {
    setRejection(null);
    const shot = await camera.current?.takePictureAsync({ quality: 0.9 });
    if (!shot) return;

    const config = await getQualityConfig();
    const fileSize = new File(shot.uri).size ?? 0;
    const verdict = evaluateShotQuality(
      { width: shot.width, height: shot.height, fileSize },
      config,
    );
    if (!verdict.ok) {
      setRejection(verdict.reason ?? 'Retake needed');
      return;
    }

    const base64 = new File(shot.uri).base64Sync();
    const sha256 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64,
    );
    setShots((s) => [...s, { pose: pose.id, uri: shot.uri, sha256 }]);
  }

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const draft = await loadDraft();
      if (!draft?.workerId) throw new Error('Worker draft missing');
      const photos = [];
      for (const shot of shots) {
        const storageKey = await uploadArtifact(
          shot.uri,
          'enrollment-photo',
          'image/jpeg',
        );
        photos.push({ pose: shot.pose, storageKey, sha256: shot.sha256 });
      }
      await apiFetch(`/workers/${draft.workerId}/enrollment`, {
        method: 'POST',
        body: { photos },
      });
      await clearDraft();
      router.dismissAll();
      router.replace('/(tabs)/workers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.progress}>
        {POSES.map((p, i) => (
          <View
            key={p.id}
            style={[styles.dot, i < shots.length && styles.dotDone]}
          />
        ))}
      </View>
      {pose ? (
        <>
          <Text style={styles.prompt}>
            {shots.length + 1}/4 · {pose.prompt}
          </Text>
          <CameraView ref={camera} style={styles.camera} facing="back" />
          {rejection && <Text style={styles.rejection}>{rejection}</Text>}
          <Pressable style={styles.button} onPress={onCapture}>
            <Text style={styles.buttonText}>Capture</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.center}>
          <Text style={styles.prompt}>All 4 poses captured ✓</Text>
          <Text style={styles.hint}>
            Photos are queued on this device and enroll the worker once
            submitted. New hires wait for admin approval before appearing on
            rosters.
          </Text>
          {error && <Text style={styles.rejection}>{error}</Text>}
          <View style={styles.row}>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => setShots([])}
            >
              <Text>Start over</Text>
            </Pressable>
            <Pressable
              style={[styles.button, busy && styles.disabled]}
              disabled={busy}
              onPress={onSubmit}
            >
              <Text style={styles.buttonText}>
                {busy ? 'Submitting…' : 'Finish enrollment'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 8 },
  progress: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ddd',
  },
  dotDone: { backgroundColor: '#14532d' },
  prompt: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  hint: { color: '#666', textAlign: 'center' },
  camera: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  rejection: { color: '#b91c1c', textAlign: 'center', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
    flexGrow: 1,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    padding: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
