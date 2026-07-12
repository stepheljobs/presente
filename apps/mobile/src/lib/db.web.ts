/**
 * Web-only database module — in-memory SQLite-compatible shim.
 * Metro picks up `*.web.ts` over `*.ts` on the web platform.
 *
 * Implements the subset of expo-sqlite's SQLiteDatabase API used by
 * capture.ts and sync.ts: execAsync, runAsync, getFirstAsync, getAllAsync.
 */

// ── In-memory table storage ───────────────────────────────────────
interface Row { [key: string]: unknown }

const tables = new Map<string, Row[]>();

function getTable(name: string): Row[] {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name)!;
}

// ── Very small SQL-interpreter for the patterns this app uses ────
// Handles: CREATE TABLE, INSERT, SELECT, DELETE with basic WHERE
class WebDB {
  async execAsync(sql: string): Promise<void> {
    const createMatch = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
    if (createMatch) getTable(createMatch[1]);
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<void> {
    // INSERT INTO local_sessions (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT ...
    const insertMatch = sql.match(
      /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    );
    if (insertMatch) {
      const [, table, cols, placeholders] = insertMatch;
      const colNames = cols.split(',').map((c) => c.trim());
      const row: Row = {};
      colNames.forEach((col, i) => {
        row[col] = params[i];
      });
      const data = getTable(table);

      // Check for ON CONFLICT (upsert)
      if (/ON\s+CONFLICT/i.test(sql)) {
        const conflictCol = colNames[0]; // primary key is first column
        const idx = data.findIndex((r) => r[conflictCol] === params[0]);
        if (idx >= 0) {
          data[idx] = { ...data[idx], ...row };
        } else {
          data.push(row);
        }
      } else {
        data.push(row);
      }
      return;
    }

    // DELETE FROM table WHERE col = ?
    const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\?)?/i);
    if (deleteMatch) {
      const [, table, whereCol] = deleteMatch;
      const data = getTable(table);
      if (whereCol) {
        tables.set(
          table,
          data.filter((r) => r[whereCol] !== params[0]),
        );
      } else {
        tables.set(table, []);
      }
      return;
    }
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const match = sql.match(/SELECT\s+.+\s+FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\?)?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?/i);
    if (!match) return [];
    const [, table, whereCol, orderCol, orderDir] = match;
    let data = [...getTable(table)];

    if (whereCol) {
      data = data.filter((r) => r[whereCol] === params[0]);
    }
    if (orderCol) {
      data.sort((a, b) => {
        const av = String(a[orderCol] ?? '');
        const bv = String(b[orderCol] ?? '');
        return orderDir?.toUpperCase() === 'DESC' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }
    return data as T[];
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
}

// ── Singleton ─────────────────────────────────────────────────────
let dbInstance: WebDB | null = null;

export function getDb(): Promise<WebDB> {
  dbInstance ??= new WebDB();
  return Promise.resolve(dbInstance);
}

// ── KV helpers (localStorage-backed, same as before) ─────────────
const KV_PREFIX = 'presente.kv.';

export async function kvSet(k: string, v: string): Promise<void> {
  localStorage.setItem(KV_PREFIX + k, v);
}

export async function kvGet(k: string): Promise<string | null> {
  return localStorage.getItem(KV_PREFIX + k);
}
