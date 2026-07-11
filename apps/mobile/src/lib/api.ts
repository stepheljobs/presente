import { accessToken } from './auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await res.json().catch(() => null)) as
    | ({ message?: string | string[] } & T)
    | null;
  if (!res.ok) {
    const message = Array.isArray(body?.message)
      ? body?.message[0]
      : body?.message;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
