import { DelegationChain, type SignedDelegation } from '@dfinity/identity';

type Provider = 'ii' | 'nfid';
type ReturnMode = 'code' | 'direct';

interface AuthParams {
  provider: Provider;
  redirectUri: string;
  returnMode: ReturnMode;
  sessionPublicKey: Uint8Array;
  state: string;
  maxTimeToLive: bigint;
}

interface InternetIdentitySuccess {
  kind: 'authorize-client-success';
  delegations: SignedDelegation[];
  userPublicKey: Uint8Array;
  authnMethod?: 'passkey' | 'pin' | 'recovery';
}

interface InternetIdentityFailure {
  kind: 'authorize-client-failure';
  text: string;
}

interface InternetIdentityReady {
  kind: 'authorize-ready';
}

type InternetIdentityMessage = InternetIdentityReady | InternetIdentitySuccess | InternetIdentityFailure;

// Internet Identity 2.0 is served from id.ai. Keeping this provider URL stable
// matters: II derives the dapp principal from the auth frontend origin, and the
// provider origin must match the postMessage target used below.
const II_AUTHORIZE_URL =
  import.meta.env.VITE_II_AUTHORIZE_URL ?? 'https://id.ai/?feature_flag_guided_upgrade=true#authorize';
const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const continueButton = document.querySelector<HTMLButtonElement>('#continue');

applyStyles();

main().catch(error => {
  setStatus(error instanceof Error ? error.message : String(error));
});

async function main(): Promise<void> {
  const params = readParams();

  if (params.provider === 'nfid') {
    // TODO: Implement NFID once its mobile delegation protocol is explicitly selected.
    throw new Error('NFID login is not implemented on this auth page yet.');
  }

  startInternetIdentity(params);
}

function readParams(): AuthParams {
  const params = new URLSearchParams(window.location.search);
  const sessionPublicKey = params.get('sessionPublicKey');
  const redirectUri = params.get('redirectUri');
  const state = params.get('state');
  const provider = (params.get('provider') ?? 'ii') as Provider;
  const returnMode = (params.get('returnMode') ?? 'code') as ReturnMode;
  const maxTimeToLive = BigInt(params.get('maxTimeToLiveNs') ?? `${30n * 60n * 1_000_000_000n}`);

  if (!sessionPublicKey || !redirectUri || !state) {
    throw new Error('Missing required mobile auth parameters.');
  }

  if (provider !== 'ii' && provider !== 'nfid') {
    throw new Error('Unsupported auth provider.');
  }

  if (returnMode !== 'code' && returnMode !== 'direct') {
    throw new Error('Unsupported return mode.');
  }

  const callback = new URL(redirectUri);
  if (!isAllowedRedirectUri(callback)) {
    throw new Error('Mobile redirectUri must use the app URL scheme or this origin app-link callback.');
  }

  if (state.length < 32) {
    throw new Error('State value is too short.');
  }

  return {
    provider,
    redirectUri,
    returnMode,
    state,
    sessionPublicKey: base64UrlDecode(sessionPublicKey),
    maxTimeToLive
  };
}

function startInternetIdentity(params: AuthParams): void {
  const authorizeUrl = new URL(II_AUTHORIZE_URL);
  const identityOrigin = authorizeUrl.origin;
  let identityWindow: Window | null = null;

  const openIdentity = () => {
    setStatus('Opening Internet Identity...');
    if (continueButton) {
      continueButton.disabled = true;
    }

    identityWindow = window.open(
      authorizeUrl.toString(),
      'internet-identity-authorize',
      'toolbar=0,location=0,menubar=0,width=500,height=700'
    );

    if (!identityWindow) {
      setStatus('Could not open Internet Identity. Try again.');
      if (continueButton) {
        continueButton.disabled = false;
      }
      return;
    }

    if (continueButton) {
      continueButton.hidden = true;
    }
  };

  window.addEventListener('message', event => {
    if (event.origin !== identityOrigin) {
      return;
    }

    void handleIdentityMessage(event.data as InternetIdentityMessage);
  });

  if (continueButton) {
    continueButton.textContent = 'Continue with Internet Identity';
    continueButton.hidden = false;
    continueButton.disabled = false;
    continueButton.onclick = openIdentity;
  }

  setStatus('');

  async function handleIdentityMessage(message: InternetIdentityMessage): Promise<void> {
    try {
      if (message.kind === 'authorize-ready') {
        if (!identityWindow) {
          throw new Error('Internet Identity window was not available.');
        }

        // The mobile app owns the matching private key. This page sends only the
        // DER-encoded session public key to Internet Identity for delegation.
        //
        // Keep this auth page on a stable origin. Internet Identity derives the
        // dapp-specific user principal from the frontend origin, so moving this
        // route to another domain/canister can change the principal the app sees.
        identityWindow.postMessage(
          {
            kind: 'authorize-client',
            sessionPublicKey: params.sessionPublicKey,
            maxTimeToLive: params.maxTimeToLive
          },
          identityOrigin
        );
        setStatus('Waiting for authorization...');
        return;
      }

      if (message.kind === 'authorize-client-failure') {
        throw new Error(message.text || 'Internet Identity authorization failed.');
      }

      if (message.kind === 'authorize-client-success') {
        setStatus('Returning to the app...');
        identityWindow?.close();

        const chain = DelegationChain.fromDelegations(message.delegations, message.userPublicKey);
        await returnDelegation(params, chain.toJSON());
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      if (continueButton) {
        continueButton.textContent = 'Continue with Internet Identity';
        continueButton.hidden = false;
        continueButton.disabled = false;
      }
    }
  }
}

async function returnDelegation(params: AuthParams, delegation: ReturnType<DelegationChain['toJSON']>): Promise<void> {
  const callback = new URL(params.redirectUri);
  callback.searchParams.set('state', params.state);

  if (params.returnMode === 'direct') {
    callback.searchParams.set('delegation', base64UrlEncode(JSON.stringify(delegation)));
    returnToApp(callback);
    return;
  }

  const response = await fetch(`/mobile-auth/store/${encodeURIComponent(params.state)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(delegation)
  });

  if (!response.ok) {
    throw new Error(`Could not create one-time delegation code: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { code?: string };
  if (!body.code) {
    throw new Error('The auth server did not return a one-time code.');
  }

  callback.searchParams.set('code', body.code);
  returnToApp(callback);
}

function returnToApp(callback: URL): void {
  const callbackUrl = callback.toString();
  const openApp = () => {
    if (isAndroidChrome()) {
      // Android Chrome often keeps same-origin HTTPS App Link redirects inside
      // the Custom Tab. An explicit package intent still targets the verified
      // HTTPS intent filter and lets the app receive the callback automatically.
      window.location.href = toAndroidIntentUrl(callback);
      return;
    }

    window.location.href = callbackUrl;
  };

  // Custom Tabs usually return automatically, but Android Chrome can block
  // app handoff after async work. Keep a user-gesture fallback.
  openApp();
  window.setTimeout(() => {
    setStatus('Tap Open app to finish.');
    if (continueButton) {
      continueButton.textContent = 'Open app';
      continueButton.hidden = false;
      continueButton.disabled = false;
      continueButton.onclick = openApp;
    }
  }, 900);
}

function toAndroidIntentUrl(callback: URL): string {
  const scheme = callback.protocol.replace(':', '');
  const hostAndPath = `${callback.host}${callback.pathname}${callback.search}${callback.hash}`;
  return `intent://${hostAndPath}#Intent;scheme=${scheme};package=com.example.icpmobileauth;end`;
}

function isAndroidChrome(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isCustomSchemeCallback(callback: URL): boolean {
  return callback.protocol !== 'http:' && callback.protocol !== 'https:';
}

function isAllowedRedirectUri(callback: URL): boolean {
  if (isCustomSchemeCallback(callback)) {
    return true;
  }

  return callback.origin === window.location.origin && callback.pathname === '/auth-callback';
}

function setStatus(message: string): void {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = window.atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function applyStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f4;
      color: #171717;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #f7f7f4;
    }

    #app {
      min-height: 100vh;
      display: flex;
      align-items: center;
      padding: 24px 22px;
      box-sizing: border-box;
    }

    .shell {
      width: min(100%, 520px);
      margin: 0 auto;
      box-sizing: border-box;
    }

    h1 {
      margin: 0 0 28px;
      color: #151515;
      font-size: 38px;
      font-weight: 800;
      line-height: 44px;
    }

    p {
      min-height: 24px;
      margin: 0 0 18px;
      color: #494949;
      font-size: 16px;
      line-height: 24px;
    }

    p:empty {
      display: none;
    }

    button {
      width: 100%;
      min-height: 56px;
      border: 0;
      border-radius: 6px;
      padding: 0 16px;
      background: #2196f3;
      color: #fff;
      font: inherit;
      font-weight: 700;
      font-size: 16px;
      text-transform: uppercase;
      box-shadow: 0 8px 18px rgba(33, 150, 243, 0.22);
      cursor: pointer;
    }

    button:disabled {
      background: #cfcfcf;
      box-shadow: none;
      cursor: default;
    }

    button[hidden] {
      display: none;
    }
  `;
  document.head.appendChild(style);
}
