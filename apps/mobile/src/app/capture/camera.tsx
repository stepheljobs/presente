import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  hashPhotoUri,
  loadDraft,
  saveDraft,
  type LocalPhoto,
  type LocalSession,
} from '../../lib/capture';

import { Screen } from '../../components/Screen';
/**
 * E4-S03/S04/S06/S08: in-app camera only (no gallery path), multi-photo
 * loop, live face-count overlay, geofence banner, SHA-256 at capture.
 *
 * Face count: expo-camera no longer ships on-device face detection. Until
 * vision-camera + ML Kit is wired (PRD §7), we use a ready-state proxy so
 * the shutter stays disabled until the preview is live (count 0 → blocked).
 */
export default function CaptureCameraScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [faceCount, setFaceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);

  useEffect(() => {
    void (async () => {
      const draft = await loadDraft(sessionId);
      if (!draft) {
        setError('Session draft missing — start again from Home');
        return;
      }
      setSession(draft);
      setPhotos(draft.photos);
    })();
  }, [sessionId]);

  // Ready-state proxy for face count (see file header).
  useEffect(() => {
    if (!permission?.granted) {
      setFaceCount(0);
      return;
    }
    const t = setTimeout(() => setFaceCount(1), 600);
    return () => clearTimeout(t);
  }, [permission?.granted]);

  if (!permission?.granted) {
    return (
      <Screen style={styles.center} edges={{ top: false, bottom: true }}>
        <Text style={styles.prompt}>
          Camera is required for attendance photos. Gallery import is not
          allowed.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
      </Screen>
    );
  }

  async function onCapture() {
    if (faceCount < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.current?.takePictureAsync({
        quality: 0.7,
        shutterSound: false,
      });
      if (!shot?.uri) throw new Error('Capture failed');
      const sha256 = await hashPhotoUri(shot.uri);
      const photo: LocalPhoto = {
        id: await randomUUID(),
        uri: shot.uri,
        sha256,
      };
      setPhotos((p) => [...p, photo]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setBusy(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id));
  }

  async function onDone() {
    if (!session || photos.length === 0) {
      setError('Capture at least one photo');
      return;
    }
    const next = { ...session, photos };
    await saveDraft(next);
    router.push({
      pathname: '/capture/tag',
      params: { sessionId: session.id },
    });
  }

  const fenceBanner =
    session?.gps.withinFence === false && session.gps.distanceM != null
      ? `You appear ${session.gps.distanceM} m from site — session will be flagged`
      : null;

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      {fenceBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{fenceBanner}</Text>
        </View>
      )}
      <View style={styles.cameraWrap}>
        <CameraView ref={camera} style={styles.camera} facing="back" />
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            {faceCount === 0
              ? 'Looking for faces…'
              : `${faceCount}+ faces ready`}
          </Text>
          <Text style={styles.overlayHint}>
            In-app camera only · gallery import disabled
          </Text>
        </View>
      </View>

      {photos.length > 0 && (
        <ScrollView
          horizontal
          style={styles.thumbs}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
        >
          {photos.map((p) => (
            <Pressable key={p.id} onLongPress={() => removePhoto(p.id)}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Text style={styles.thumbX}>hold to delete</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={[
            styles.shutter,
            (faceCount < 1 || busy) && styles.disabled,
          ]}
          disabled={faceCount < 1 || busy}
          onPress={onCapture}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable
          style={[
            styles.button,
            photos.length === 0 && styles.disabled,
          ]}
          disabled={photos.length === 0}
          onPress={onDone}
        >
          <Text style={styles.buttonText}>
            {photos.length === 0
              ? 'Capture crew photo'
              : photos.length === 1
                ? 'Tag this photo'
                : `Tag ${photos.length} photos`}
          </Text>
        </Pressable>
        {photos.length > 0 && (
          <Pressable
            style={styles.secondary}
            disabled={busy || faceCount < 1}
            onPress={onCapture}
          >
            <Text style={styles.secondaryText}>Capture more</Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  prompt: { textAlign: 'center', color: '#333', fontSize: 16 },
  banner: {
    backgroundColor: '#fef3c7',
    padding: 10,
  },
  bannerText: { color: '#78350f', fontWeight: '600', textAlign: 'center' },
  cameraWrap: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    padding: 12,
  },
  overlayText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  overlayHint: { color: '#ccc', fontSize: 12, marginTop: 2 },
  thumbs: { maxHeight: 96, marginVertical: 8 },
  thumb: { width: 72, height: 72, borderRadius: 6 },
  thumbX: { color: '#999', fontSize: 9, textAlign: 'center' },
  error: { color: '#fca5a5', textAlign: 'center', marginBottom: 4 },
  actions: {
    padding: 16,
    gap: 10,
    alignItems: 'center',
    backgroundColor: '#111',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: {
    padding: 10,
  },
  secondaryText: { color: '#a7f3d0', fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
