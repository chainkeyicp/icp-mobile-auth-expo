import * as SecureStore from 'expo-secure-store';

const DEVICE_IDENTITY_KEY = 'icp.mobile.auth.device.identity.v1';
const DEVICE_META_KEY = 'icp.mobile.auth.device.meta.v1';

export interface StoredDeviceLoginMeta {
  version: 1;
  ownerPrincipal: string;
  devicePrincipal: string;
  label: string;
  authFrontendUrl: string;
  canisterId: string;
  createdAtMs: number;
}

export interface StoredDeviceLoginCredential extends StoredDeviceLoginMeta {
  identityJson: string;
}

const DEVICE_AUTH_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock ICP Mobile Auth'
};

export async function saveStoredDeviceLogin(credential: StoredDeviceLoginCredential): Promise<void> {
  await ensureSecureStore();
  const { identityJson: _identityJson, ...meta } = credential;

  await SecureStore.setItemAsync(DEVICE_META_KEY, JSON.stringify(meta), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  });
  await SecureStore.setItemAsync(DEVICE_IDENTITY_KEY, JSON.stringify(credential), DEVICE_AUTH_OPTIONS);
}

export async function loadStoredDeviceLoginMeta(): Promise<StoredDeviceLoginMeta | null> {
  await ensureSecureStore();
  const encoded = await SecureStore.getItemAsync(DEVICE_META_KEY);
  return encoded ? (JSON.parse(encoded) as StoredDeviceLoginMeta) : null;
}

export async function loadStoredDeviceLogin(): Promise<StoredDeviceLoginCredential | null> {
  await ensureSecureStore();
  const encoded = await SecureStore.getItemAsync(DEVICE_IDENTITY_KEY, DEVICE_AUTH_OPTIONS);
  return encoded ? (JSON.parse(encoded) as StoredDeviceLoginCredential) : null;
}

export async function clearStoredDeviceLogin(): Promise<void> {
  await ensureSecureStore();
  await SecureStore.deleteItemAsync(DEVICE_IDENTITY_KEY, DEVICE_AUTH_OPTIONS);
  await SecureStore.deleteItemAsync(DEVICE_META_KEY);
}

async function ensureSecureStore(): Promise<void> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new Error('SecureStore is not available on this platform. Use a development or standalone mobile build.');
  }
}
