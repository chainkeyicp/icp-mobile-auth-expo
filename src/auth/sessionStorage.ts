import * as SecureStore from 'expo-secure-store';

import type { JsonDelegationChain } from './delegation';

const SESSION_KEY = 'icp.mobile.auth.session.v1';

export interface StoredIcpSession {
  version: 1;
  provider: 'ii' | 'nfid';
  sessionIdentityJson: string;
  delegationChainJson: JsonDelegationChain;
  expirationMs: number;
  principal: string;
  authFrontendUrl: string;
  createdAtMs: number;
}

export async function saveStoredSession(session: StoredIcpSession): Promise<void> {
  await ensureSecureStore();
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  });
}

export async function loadStoredSession(): Promise<StoredIcpSession | null> {
  await ensureSecureStore();
  const encoded = await SecureStore.getItemAsync(SESSION_KEY);
  return encoded ? (JSON.parse(encoded) as StoredIcpSession) : null;
}

export async function clearStoredSession(): Promise<void> {
  await ensureSecureStore();
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function ensureSecureStore(): Promise<void> {
  const available = await SecureStore.isAvailableAsync();
  if (!available) {
    throw new Error('SecureStore is not available on this platform. Use a development or standalone mobile build.');
  }
}
