import * as Linking from 'expo-linking';

import { APP_SCHEME, AUTH_APP_LINK_HOST, AUTH_CALLBACK_HOST } from '../config/icp';

export interface AuthCallbackParams {
  state: string;
  code?: string;
  delegation?: string;
}

export function parseAuthCallbackUrl(callbackUrl: string): AuthCallbackParams {
  const linkingResult = Linking.parse(callbackUrl);
  const parsed = new URL(callbackUrl);
  const isCustomSchemeCallback =
    parsed.protocol === `${APP_SCHEME}:` &&
    linkingResult.scheme === APP_SCHEME &&
    parsed.hostname === AUTH_CALLBACK_HOST;
  const isHttpsAppLinkCallback =
    parsed.protocol === 'https:' &&
    parsed.hostname === AUTH_APP_LINK_HOST &&
    parsed.pathname === `/${AUTH_CALLBACK_HOST}`;

  if (!isCustomSchemeCallback && !isHttpsAppLinkCallback) {
    throw new Error('Ignoring callback from an unexpected URL.');
  }

  const state = parsed.searchParams.get('state');
  if (!state) {
    throw new Error('Authentication callback is missing state.');
  }

  const code = parsed.searchParams.get('code') ?? undefined;
  const delegation = parsed.searchParams.get('delegation') ?? undefined;

  if (!code && !delegation) {
    throw new Error('Authentication callback did not contain a code or delegation.');
  }

  return { state, code, delegation };
}
