/**
 * Web secure-storage shim — expo-secure-store has no native bridge in the
 * browser (`getValueWithKeyAsync is not a function`). Use localStorage so
 * capture device-id and other callers work when dogfooding on web.
 *
 * Production engineer flows still run on a native dev client.
 */

const PREFIX = 'presente.ss.';

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* private mode / quota — ignore */
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
