/**
 * Web-only database module — uses localStorage instead of expo-sqlite.
 * Metro automatically picks up `*.web.ts` over `*.ts` on the web platform.
 */
const KV_PREFIX = 'presente.kv.';

export async function getDb(): Promise<void> {
  // No-op on web
  return;
}

export async function kvSet(k: string, v: string): Promise<void> {
  localStorage.setItem(KV_PREFIX + k, v);
}

export async function kvGet(k: string): Promise<string | null> {
  return localStorage.getItem(KV_PREFIX + k);
}
