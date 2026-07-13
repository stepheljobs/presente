import { accessToken, logout } from './auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Authenticated JSON fetch; an expired/invalid session bounces to login. */
export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken() ?? ''}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) {
    logout();
    window.location.assign('/login');
    throw new ApiError(401, 'Session expired');
  }
  const body = (await res.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  if (!res.ok) {
    const message = Array.isArray(body?.message)
      ? body.message[0]
      : body?.message;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
