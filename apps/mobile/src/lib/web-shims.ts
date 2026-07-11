/**
 * Web-compatible shims for Expo native modules.
 *
 * This module is loaded ONLY on web (platform extension ensures Metro
 * resolves it instead of the native package). It replaces:
 *  - expo-sqlite       → in-memory Map (no persistence needed for dev)
 *  - expo-secure-store → localStorage
 *  - expo-crypto       → Web Crypto API
 */

// ── SecureStore shim ──────────────────────────────────────────────
export const secureStore = {
  async getItemAsync(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

// ── Crypto shim ───────────────────────────────────────────────────
export const crypto = {
  async getRandomBytesAsync(n: number): Promise<Uint8Array> {
    const arr = new Uint8Array(n);
    window.crypto.getRandomValues(arr);
    return arr;
  },
};

// ── SQLite shim (in-memory KV) ────────────────────────────────────
interface Row { [key: string]: unknown }

class WebSQLiteDatabase {
  private kv = new Map<string, string>();

  async execAsync(_sql: string): Promise<void> {
    // No-op for web (PRAGMA key, CREATE TABLE — both irrelevant in-memory)
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<void> {
    // INSERT INTO local_kv (k, v) VALUES (?, ?) ON CONFLICT ...
    if (sql.includes('local_kv')) {
      this.kv.set(params[0] as string, params[1] as string);
    }
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (sql.includes('local_kv') && sql.includes('SELECT')) {
      const v = this.kv.get(params[0] as string);
      return v ? ({ v } as T) : null;
    }
    return null;
  }

  async getAllAsync<T>(_sql: string, _params: unknown[] = []): Promise<T[]> {
    return [];
  }
}

export const SQLite = {
  async openDatabaseAsync(_name: string): Promise<WebSQLiteDatabase> {
    return new WebSQLiteDatabase();
  },
};
