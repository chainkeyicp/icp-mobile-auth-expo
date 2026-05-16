import * as SecureStore from 'expo-secure-store';

const DEVICE_IDENTITY_AUTH_KEY = 'icp.mobile.auth.device.identity.v1';
const DEVICE_IDENTITY_COMPAT_KEY = 'icp.mobile.auth.device.identity.compat.v1';
const DEVICE_META_KEY = 'icp.mobile.auth.device.meta.v1';

export type DeviceLoginProtection = 'user-authentication' | 'secure-store';

export interface StoredDeviceLoginMeta {
  version: 1;
  ownerPrincipal: string;
  devicePrincipal: string;
  label: string;
  authFrontendUrl: string;
  canisterId: string;
  createdAtMs: number;
  protection?: DeviceLoginProtection;
}

export interface StoredDeviceLoginCredential extends StoredDeviceLoginMeta {
  identityJson: string;
}

const DEVICE_AUTH_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock ICP Mobile Auth'
};

const DEVICE_COMPAT_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

export async function saveStoredDeviceLogin(credential: StoredDeviceLoginCredential): Promise<void> {
  await ensureSecureStore();
  const protectedCredential: StoredDeviceLoginCredential = {
    ...credential,
    protection: 'user-authentication'
  };

  try {
    await SecureStore.setItemAsync(
      DEVICE_IDENTITY_AUTH_KEY,
      JSON.stringify(protectedCredential),
      DEVICE_AUTH_OPTIONS
    );
    await deleteSecureStoreItem(DEVICE_IDENTITY_COMPAT_KEY, DEVICE_COMPAT_OPTIONS);
    await saveDeviceMeta(protectedCredential);
    return;
  } catch (reason) {
    if (!isUserAuthenticationUnavailable(reason)) {
      throw reason;
    }
  }

  // Some Android devices have a lock screen but no enrolled biometrics. Expo
  // SecureStore rejects requireAuthentication in that state, so keep this as a
  // compatibility fallback. Production wallets should prefer the authenticated
  // path above or add an explicit app PIN/password encryption layer.
  const compatCredential: StoredDeviceLoginCredential = {
    ...credential,
    protection: 'secure-store'
  };
  await SecureStore.setItemAsync(
    DEVICE_IDENTITY_COMPAT_KEY,
    JSON.stringify(compatCredential),
    DEVICE_COMPAT_OPTIONS
  );
  await deleteSecureStoreItem(DEVICE_IDENTITY_AUTH_KEY, DEVICE_AUTH_OPTIONS);
  await saveDeviceMeta(compatCredential);
}

export async function loadStoredDeviceLoginMeta(): Promise<StoredDeviceLoginMeta | null> {
  await ensureSecureStore();
  const encoded = await SecureStore.getItemAsync(DEVICE_META_KEY);
  return encoded ? normalizeCredentialMeta(JSON.parse(encoded) as StoredDeviceLoginMeta) : null;
}

export async function loadStoredDeviceLogin(): Promise<StoredDeviceLoginCredential | null> {
  await ensureSecureStore();
  const meta = await loadStoredDeviceLoginMeta();
  if (!meta) {
    return null;
  }

  if (meta.protection === 'secure-store') {
    const compatEncoded = await SecureStore.getItemAsync(DEVICE_IDENTITY_COMPAT_KEY, DEVICE_COMPAT_OPTIONS);
    if (!compatEncoded) {
      await clearStoredDeviceLogin();
      return null;
    }
    return normalizeCredential(JSON.parse(compatEncoded) as StoredDeviceLoginCredential);
  }

  try {
    const authEncoded = await SecureStore.getItemAsync(DEVICE_IDENTITY_AUTH_KEY, DEVICE_AUTH_OPTIONS);
    if (authEncoded) {
      return normalizeCredential(JSON.parse(authEncoded) as StoredDeviceLoginCredential);
    }
  } catch (reason) {
    if (!isUserAuthenticationUnavailable(reason)) {
      throw reason;
    }
  }

  const compatEncoded = await SecureStore.getItemAsync(DEVICE_IDENTITY_COMPAT_KEY, DEVICE_COMPAT_OPTIONS);
  if (compatEncoded) {
    return normalizeCredential(JSON.parse(compatEncoded) as StoredDeviceLoginCredential);
  }

  await clearStoredDeviceLogin();
  return null;
}

export async function clearStoredDeviceLogin(): Promise<void> {
  await ensureSecureStore();
  await deleteSecureStoreItem(DEVICE_IDENTITY_AUTH_KEY, DEVICE_AUTH_OPTIONS);
  await deleteSecureStoreItem(DEVICE_IDENTITY_AUTH_KEY, DEVICE_COMPAT_OPTIONS);
  await deleteSecureStoreItem(DEVICE_IDENTITY_COMPAT_KEY, DEVICE_COMPAT_OPTIONS);
  await deleteSecureStoreItem(DEVICE_META_KEY, DEVICE_COMPAT_OPTIONS);
}

async function ensureSecureStore(): Promise<void> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new Error('SecureStore is not available on this platform. Use a development or standalone mobile build.');
  }
}

async function saveDeviceMeta(credential: StoredDeviceLoginCredential): Promise<void> {
  const { identityJson: _identityJson, ...meta } = credential;
  await SecureStore.setItemAsync(DEVICE_META_KEY, JSON.stringify(meta), DEVICE_COMPAT_OPTIONS);
}

async function deleteSecureStoreItem(key: string, options?: SecureStore.SecureStoreOptions): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, options);
  } catch {
    // Best-effort cleanup. Missing biometrics can also make authenticated
    // deletion fail, and the non-authenticated delete call above/below handles
    // compatibility entries.
  }
}

function normalizeCredentialMeta(meta: StoredDeviceLoginMeta): StoredDeviceLoginMeta {
  return {
    ...meta,
    protection: meta.protection ?? 'user-authentication'
  };
}

function normalizeCredential(credential: StoredDeviceLoginCredential): StoredDeviceLoginCredential {
  return {
    ...credential,
    protection: credential.protection ?? 'user-authentication'
  };
}

function isUserAuthenticationUnavailable(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('no biometrics') ||
    normalized.includes('not enrolled') ||
    normalized.includes('not currently enrolled') ||
    normalized.includes('authentication is not available') ||
    normalized.includes('user authentication is not available')
  );
}
