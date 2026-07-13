import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiFetch } from '../../lib/api';
import { loadDraft, uploadArtifact } from '../../lib/enrollment';

import { Screen } from '../../components/Screen';
/**
 * E3-S05: photograph the signed/thumbprinted paper consent form.
 * Lands the worker in the same state as an on-screen signature.
 */
export default function PaperConsentScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  if (!permission?.granted) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <Text>Camera access is needed to photograph the form.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
      </Screen>
    );
  }

  async function onCapture() {
    const shot = await camera.current?.takePictureAsync({ quality: 0.8 });
    if (shot) setPhotoUri(shot.uri);
  }

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      const draft = await loadDraft();
      if (!draft?.workerId) throw new Error('Worker draft missing');
      const artifactKey = await uploadArtifact(
        photoUri!,
        'consent',
        'image/jpeg',
      );
      await apiFetch(`/workers/${draft.workerId}/consents`, {
        method: 'POST',
        body: {
          type: 'paper',
          artifactKey,
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
      {photoUri ? (
        <>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.row}>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => setPhotoUri(null)}
            >
              <Text>Retake</Text>
            </Pressable>
            <Pressable
              style={[styles.button, busy && styles.disabled]}
              disabled={busy}
              onPress={onSave}
            >
              <Text style={styles.buttonText}>
                {busy ? 'Saving…' : 'Use this photo'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <CameraView ref={camera} style={styles.camera} />
          <Text style={styles.hint}>
            Fill the frame with the signed consent form.
          </Text>
          <Pressable style={styles.button} onPress={onCapture}>
            <Text style={styles.buttonText}>Capture</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  camera: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  preview: { flex: 1, borderRadius: 8 },
  hint: { color: '#666', textAlign: 'center' },
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
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c' },
});
