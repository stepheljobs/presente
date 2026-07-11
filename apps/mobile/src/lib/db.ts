import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

const DB_KEY_STORE = 'presente.dbKey';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 256-bit SQLCipher key, generated once and held only in the Keystore-backed
 * SecureStore (E0-S09). The raw database file on disk is unreadable without
 * it. Requires the expo-sqlite `useSQLCipher` build flag (no Expo Go).
 */
async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_STORE);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(DB_KEY_STORE, key);
  return key;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const key = await getOrCreateDbKey();
    const db = await SQLite.openDatabaseAsync('presente.db');
    // Raw-hex key form; must be the first statement on the connection.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS local_kv (
         k TEXT PRIMARY KEY,
         v TEXT NOT NULL
       )`,
    );
    return db;
  })();
  return dbPromise;
}

export async function kvSet(k: string, v: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO local_kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v',
    [k, v],
  );
}

export async function kvGet(k: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: string }>(
    'SELECT v FROM local_kv WHERE k = ?',
    [k],
  );
  return row?.v ?? null;
}
