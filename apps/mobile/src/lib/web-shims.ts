/**
 * @deprecated Prefer platform modules:
 *  - `secure-store.web.ts` for storage
 *  - `db.web.ts` for SQLite/KV
 *  - `auth.web.ts` for auth
 *
 * Thin re-export so any leftover imports do not break web.
 */
import {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
} from './secure-store.web';

export { getItemAsync, setItemAsync, deleteItemAsync };

export const secureStore = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};
