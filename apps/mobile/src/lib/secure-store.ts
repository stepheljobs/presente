/**
 * Native secure storage (Keystore / Keychain) via expo-secure-store.
 * Web uses `secure-store.web.ts` (localStorage) via Metro platform resolution.
 */
export {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
} from 'expo-secure-store';
