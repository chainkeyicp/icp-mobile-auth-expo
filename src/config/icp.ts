export const APP_SCHEME = 'icpmobileauth';
export const AUTH_CALLBACK_HOST = 'auth-callback';
export const AUTH_APP_LINK_HOST = process.env.EXPO_PUBLIC_AUTH_APP_LINK_HOST ?? '';
export const AUTH_CALLBACK_URL =
  process.env.EXPO_PUBLIC_AUTH_CALLBACK_URL?.replace(/\/$/, '') ??
  (AUTH_APP_LINK_HOST
    ? `https://${AUTH_APP_LINK_HOST}/${AUTH_CALLBACK_HOST}`
    : `${APP_SCHEME}://${AUTH_CALLBACK_HOST}`);

export const AUTH_FRONTEND_URL =
  process.env.EXPO_PUBLIC_AUTH_FRONTEND_URL?.replace(/\/$/, '') ?? '';

export const MOBILE_AUTH_CANISTER_ID =
  process.env.EXPO_PUBLIC_MOBILE_AUTH_CANISTER_ID ?? inferCanisterIdFromAuthUrl(AUTH_FRONTEND_URL);

export const IC_HOST = process.env.EXPO_PUBLIC_IC_HOST ?? 'https://icp-api.io';
export const SAMPLE_CANISTER_ID = process.env.EXPO_PUBLIC_SAMPLE_CANISTER_ID ?? '';
export const ICP_LEDGER_CANISTER_ID =
  process.env.EXPO_PUBLIC_ICP_LEDGER_CANISTER_ID ?? 'ryjl3-tyaaa-aaaaa-aaaba-cai';

export const MOBILE_AUTH_RETURN_MODE =
  process.env.EXPO_PUBLIC_MOBILE_AUTH_RETURN_MODE === 'direct' ? 'direct' : 'code';

const DELEGATION_TTL_DAYS = 30;

// Internet Identity supports client delegations up to 30 days. The app stores
// the session key locally, so this enables Ledger signing until the delegation
// expires without reopening id.ai.
export const DEFAULT_DELEGATION_TTL_NS =
  BigInt(DELEGATION_TTL_DAYS * 24 * 60 * 60) * BigInt(1_000_000_000);

function inferCanisterIdFromAuthUrl(authUrl: string): string {
  try {
    const hostname = new URL(authUrl).hostname;
    const canisterId = hostname.split('.')[0] ?? '';
    return canisterId.includes('-') ? canisterId : '';
  } catch {
    return '';
  }
}
