import { HttpAgent, type Identity } from '@dfinity/agent';
import { DelegationIdentity, Ed25519KeyIdentity } from '@dfinity/identity';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import {
  AUTH_CALLBACK_URL,
  AUTH_FRONTEND_URL,
  DEFAULT_DELEGATION_TTL_NS,
  IC_HOST,
  MOBILE_AUTH_RETURN_MODE
} from '../config/icp';
import { base64UrlDecodeJson, base64UrlEncode } from './base64url';
import { parseAuthCallbackUrl } from './deepLinking';
import {
  chainFromJson,
  getDelegationExpirationMs,
  isDelegationExpired,
  normalizeDelegationJson,
  type JsonDelegationChain
} from './delegation';
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  type StoredIcpSession
} from './sessionStorage';

export type AuthProvider = 'ii' | 'nfid';

export interface AuthSession {
  identity: DelegationIdentity;
  principal: string;
  expirationMs: number;
  provider: AuthProvider;
}

interface ExchangeResponse {
  delegation: JsonDelegationChain | string;
}

export async function loginWithIcp(provider: AuthProvider = 'ii'): Promise<AuthSession> {
  if (provider === 'nfid') {
    throw new Error('NFID mobile delegation support is not implemented yet. TODO: add an NFID protocol adapter.');
  }

  if (!AUTH_FRONTEND_URL) {
    throw new Error('Set EXPO_PUBLIC_AUTH_FRONTEND_URL to the hosted /mobile-auth origin before logging in.');
  }

  const sessionIdentity = Ed25519KeyIdentity.generate();
  const sessionPublicKey = base64UrlEncode(sessionIdentity.getPublicKey().toDer());
  const state = await createState();
  const loginUrl = buildMobileAuthUrl({
    provider,
    sessionPublicKey,
    state,
    redirectUri: AUTH_CALLBACK_URL
  });

  const result = await WebBrowser.openAuthSessionAsync(loginUrl, AUTH_CALLBACK_URL, {
    preferEphemeralSession: false
  });

  if (result.type !== 'success') {
    throw new Error(result.type === 'cancel' ? 'Login was cancelled.' : 'Login did not complete.');
  }

  const callback = parseAuthCallbackUrl(result.url);
  if (callback.state !== state) {
    throw new Error('Authentication state mismatch. The callback was rejected.');
  }

  let delegationJson: JsonDelegationChain;
  if (callback.code) {
    delegationJson = normalizeDelegationJson(await exchangeDelegationCode(callback.code, state));
  } else if (callback.delegation) {
    if (!__DEV__) {
      throw new Error('Direct delegation callback is disabled outside development builds.');
    }
    delegationJson = base64UrlDecodeJson<JsonDelegationChain>(callback.delegation);
  } else {
    throw new Error('No delegation was returned by the authentication page.');
  }

  const delegationChain = chainFromJson(delegationJson);
  const identity = DelegationIdentity.fromDelegation(sessionIdentity, delegationChain);
  const expirationMs = getDelegationExpirationMs(delegationJson);

  if (isDelegationExpired(expirationMs)) {
    throw new Error('The returned delegation is already expired.');
  }

  const principal = identity.getPrincipal().toText();

  await saveStoredSession({
    version: 1,
    provider,
    sessionIdentityJson: JSON.stringify(sessionIdentity.toJSON()),
    delegationChainJson: delegationJson,
    expirationMs,
    principal,
    authFrontendUrl: AUTH_FRONTEND_URL,
    createdAtMs: Date.now()
  });

  return { identity, principal, expirationMs, provider };
}

export async function restoreSession(): Promise<AuthSession | null> {
  const stored = await loadStoredSession();
  if (!stored) {
    return null;
  }

  if (stored.authFrontendUrl !== AUTH_FRONTEND_URL) {
    await clearStoredSession();
    return null;
  }

  if (isDelegationExpired(stored.expirationMs)) {
    await clearStoredSession();
    return null;
  }

  const sessionIdentity = Ed25519KeyIdentity.fromJSON(stored.sessionIdentityJson);
  const delegationChain = chainFromJson(stored.delegationChainJson);
  const identity = DelegationIdentity.fromDelegation(sessionIdentity, delegationChain);

  return {
    identity,
    principal: stored.principal,
    expirationMs: stored.expirationMs,
    provider: stored.provider
  };
}

export async function logout(): Promise<void> {
  await clearStoredSession();
}

export async function createAuthenticatedAgent(identity: Identity): Promise<HttpAgent> {
  const agent = new HttpAgent({ identity, host: IC_HOST });

  // Development-only local replica support. This fetches the local replica root key;
  // it does not bypass certificate verification and must not be replaced with
  // blsVerify: () => true in production.
  if (__DEV__ && isLocalReplicaHost(IC_HOST)) {
    await agent.fetchRootKey();
  }

  return agent;
}

function buildMobileAuthUrl({
  provider,
  sessionPublicKey,
  redirectUri,
  state
}: {
  provider: AuthProvider;
  sessionPublicKey: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('/mobile-auth', AUTH_FRONTEND_URL);
  url.searchParams.set('sessionPublicKey', sessionPublicKey);
  url.searchParams.set('redirectUri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('provider', provider);
  url.searchParams.set('returnMode', MOBILE_AUTH_RETURN_MODE);
  url.searchParams.set('maxTimeToLiveNs', DEFAULT_DELEGATION_TTL_NS.toString());
  return url.toString();
}

async function createState(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return base64UrlEncode(bytes);
}

async function exchangeDelegationCode(code: string, state: string): Promise<JsonDelegationChain | string> {
  const encodedState = encodeURIComponent(state);
  const encodedCode = encodeURIComponent(code);
  const response = await fetch(`${AUTH_FRONTEND_URL}/mobile-auth/exchange/${encodedState}/${encodedCode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, state })
  });

  if (!response.ok) {
    throw new Error(`Delegation exchange failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as ExchangeResponse;
  if (!body.delegation) {
    throw new Error('Delegation exchange response did not contain a delegation.');
  }

  return body.delegation;
}

function isLocalReplicaHost(host: string): boolean {
  try {
    const parsed = new URL(host);
    return ['localhost', '127.0.0.1', '10.0.2.2'].includes(parsed.hostname);
  } catch {
    return false;
  }
}
