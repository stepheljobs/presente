import { randomUUID } from 'expo-crypto';
import { apiFetch } from './api';
import { kvGet, kvSet } from './db';

/**
 * Enrollment flow state (E3 Flow 2). The draft lives in the encrypted
 * local DB so a killed app or offline site visit never loses form input
 * (E3-S02 AC).
 */
export interface EnrollmentDraft {
  workerId?: string;
  fullName: string;
  nickname?: string;
  position?: string;
  phone?: string;
  startDate?: string;
  consentLanguage?: 'en' | 'tl';
}

const DRAFT_KEY = 'enrollment.draft';

export async function loadDraft(): Promise<EnrollmentDraft | null> {
  const raw = await kvGet(DRAFT_KEY);
  return raw ? (JSON.parse(raw) as EnrollmentDraft) : null;
}

export async function saveDraft(draft: EnrollmentDraft): Promise<void> {
  await kvSet(DRAFT_KEY, JSON.stringify(draft));
}

export async function clearDraft(): Promise<void> {
  await kvSet(DRAFT_KEY, '');
}

export interface ConsentNotice {
  version: number;
  en: string;
  tl: string;
}

/** E3-S03: server-held copy, cached locally for offline sites. */
export async function getConsentNotice(): Promise<ConsentNotice> {
  try {
    const notice = await apiFetch<ConsentNotice>('/config/consent-notice');
    await kvSet('consent.notice', JSON.stringify(notice));
    return notice;
  } catch {
    const cached = await kvGet('consent.notice');
    if (cached) return JSON.parse(cached) as ConsentNotice;
    throw new Error('Consent notice unavailable — connect once to download it');
  }
}

export interface QualityConfig {
  minJpegBytesPerPixel: number;
  minWidthPx: number;
  minMeanLuma: number;
  maxMeanLuma: number;
}

/** E3-S08: remotely tunable thresholds, cached for offline capture. */
export async function getQualityConfig(): Promise<QualityConfig> {
  try {
    const config = await apiFetch<QualityConfig>('/config/enrollment-quality');
    await kvSet('enrollment.quality', JSON.stringify(config));
    return config;
  } catch {
    const cached = await kvGet('enrollment.quality');
    if (cached) return JSON.parse(cached) as QualityConfig;
    return {
      minJpegBytesPerPixel: 0.08,
      minWidthPx: 720,
      minMeanLuma: 40,
      maxMeanLuma: 220,
    };
  }
}

/**
 * E3-S08 on-device gate. Without raw pixel access (needs a frame
 * processor — E4 work), the blur proxy is JPEG bytes-per-pixel: heavily
 * blurred or featureless shots compress far below normal face photos.
 */
export function evaluateShotQuality(
  shot: { width: number; height: number; fileSize: number },
  config: QualityConfig,
): { ok: boolean; reason?: string } {
  if (shot.width < config.minWidthPx) {
    return { ok: false, reason: 'Image too small — move closer' };
  }
  const bpp = shot.fileSize / (shot.width * shot.height);
  if (bpp < config.minJpegBytesPerPixel) {
    return { ok: false, reason: 'Too blurry — hold steady and retake' };
  }
  return { ok: true };
}

/** Best-effort artifact upload; offline falls back to a pending-key the
 * E5 sync queue will resolve. */
export async function uploadArtifact(
  localUri: string,
  category: 'consent' | 'enrollment-photo' | 'session-photo',
  contentType: string,
): Promise<string> {
  try {
    const signed = await apiFetch<{ url: string; key: string }>(
      '/uploads/sign',
      { method: 'POST', body: { category, contentType } },
    );
    const blob = await (await fetch(localUri)).blob();
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    return signed.key;
  } catch {
    // Queue for later sync (E5); the local file stays on disk.
    const key = `pending-upload/${category}/${randomUUID()}`;
    await kvSet(`upload.queue.${key}`, localUri);
    return key;
  }
}

export const POSES = [
  { id: 'front', prompt: 'Look straight at the camera' },
  { id: 'left', prompt: 'Turn your head to the LEFT' },
  { id: 'right', prompt: 'Turn your head to the RIGHT' },
  { id: 'hard_hat', prompt: 'Put your hard hat ON and look straight' },
] as const;

export type PoseId = (typeof POSES)[number]['id'];
