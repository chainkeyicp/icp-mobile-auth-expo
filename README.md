# ICP Mobile Auth for Expo

This project implements a React Native Expo login flow for Internet Computer authentication without using `react-native-webview`. The mobile app creates and owns the session private key, opens a system in-app auth session for Internet Identity, receives a delegation chain, and uses that delegation with `@dfinity/agent`.

## What Is Included

- Expo app scheme: `icpmobileauth`
- React Native auth service using `expo-web-browser` / `openAuthSessionAsync`
- Ed25519 session identity generation in React Native
- Secure session persistence with `expo-secure-store`
- Delegation restore and expiration checks
- Sample authenticated actor call
- Real ICP Ledger ICRC-1 balance, receive principal, fee, and transfer UI
- `/mobile-auth` web page that speaks the Internet Identity Client Authentication Protocol
- One-time code exchange server for returning delegation chains without putting them in the deep link URL

## Why AuthSession Instead Of WebView

Internet Identity uses WebAuthn/passkeys. A plain embedded WebView is the wrong primitive for this flow because passkey availability, browser security policy, and identity-provider expectations differ from the real browser authentication surface. `WebBrowser.openAuthSessionAsync(loginUrl, redirectUri)` uses the platform auth session style flow, keeps the user inside an in-app browser session, and returns to the app through the configured URL scheme.

This project intentionally does not depend on `react-native-webview`.

## Why React Native Owns The Session Private Key

Internet Identity does not need the mobile app private key. It needs a session public key to sign a delegation to. The React Native app generates an Ed25519 session identity, keeps the private key in memory during login, and sends only the DER public key to `/mobile-auth`.

The web page forwards that public key to Internet Identity. After the user authorizes, Internet Identity returns a signed delegation chain that allows the session key to act as the delegated user principal until expiration. The app combines the locally held private key with that delegation chain using `DelegationIdentity.fromDelegation(...)`.

Never move the session private key through a query string, web page, callback URL, or backend service.

## Stable Auth Origin

Keep the hosted `/mobile-auth` origin stable. Internet Identity principals are scoped to the client frontend origin, so changing the auth frontend domain or canister can change the derived user principal seen by the mobile app.

TODO: If you later experiment with native passkeys, universal links, associated domains, asset links, or WebView-based prototypes, validate domain ownership and app association requirements first. Do not relax this implementation into a plain WebView login.

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
EXPO_PUBLIC_AUTH_FRONTEND_URL=https://<AUTH_FRONTEND_CANISTER_OR_DOMAIN>
EXPO_PUBLIC_IC_HOST=https://icp-api.io
EXPO_PUBLIC_SAMPLE_CANISTER_ID=<sample_canister_id>
EXPO_PUBLIC_ICP_LEDGER_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai
EXPO_PUBLIC_MOBILE_AUTH_RETURN_MODE=code
```

The app scheme is configured in `app.json`:

```json
{
  "expo": {
    "scheme": "icpmobileauth"
  }
}
```

The mobile callback is:

```text
icpmobileauth://auth-callback
```

For a production Android App Link callback without a custom domain, deploy the `mobile_auth` canister and then set:

```bash
EXPO_PUBLIC_AUTH_FRONTEND_URL=https://<AUTH_CANISTER_ID>.raw.icp0.io
EXPO_PUBLIC_AUTH_APP_LINK_HOST=<AUTH_CANISTER_ID>.raw.icp0.io
EXPO_PUBLIC_AUTH_CALLBACK_URL=https://<AUTH_CANISTER_ID>.raw.icp0.io/auth-callback
```

The app still keeps the custom `icpmobileauth://auth-callback` scheme for development fallback, but the production callback should use the verified HTTPS app link.

## Quick Android Phone Install

These steps install the current mainnet test build on a real Android phone using the hosted auth canister already configured for this repo.

Prerequisites:

- Node.js 20 or newer and `npm`
- Android Studio or a JDK/Android SDK setup that can run Gradle
- `adb` in your `PATH`
- USB debugging enabled on the phone
- GitHub repo cloned locally

Clone and install dependencies:

```bash
git clone https://github.com/chainkeyicp/icp-mobile-auth-expo.git
cd icp-mobile-auth-expo
npm install
```

Create `.env` from `.env.mainnet.example` and use the current hosted auth canister:

```bash
EXPO_PUBLIC_AUTH_FRONTEND_URL=https://uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io
EXPO_PUBLIC_AUTH_APP_LINK_HOST=uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io
EXPO_PUBLIC_AUTH_CALLBACK_URL=https://uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io/auth-callback
EXPO_PUBLIC_IC_HOST=https://icp-api.io
EXPO_PUBLIC_SAMPLE_CANISTER_ID=
EXPO_PUBLIC_ICP_LEDGER_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai
EXPO_PUBLIC_MOBILE_AUTH_RETURN_MODE=code
```

Connect the phone and confirm `adb` sees it:

```bash
adb devices
```

Build and install the Android APK from PowerShell:

```powershell
$env:EXPO_PUBLIC_AUTH_FRONTEND_URL='https://uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io'
$env:EXPO_PUBLIC_AUTH_APP_LINK_HOST='uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io'
$env:EXPO_PUBLIC_AUTH_CALLBACK_URL='https://uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io/auth-callback'
$env:EXPO_PUBLIC_IC_HOST='https://icp-api.io'
$env:EXPO_PUBLIC_SAMPLE_CANISTER_ID=''
$env:EXPO_PUBLIC_ICP_LEDGER_CANISTER_ID='ryjl3-tyaaa-aaaaa-aaaba-cai'
$env:EXPO_PUBLIC_MOBILE_AUTH_RETURN_MODE='code'

.\android\gradlew.bat -p android :app:assembleRelease "-PauthAppLinkHost=uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io" "-PreactNativeArchitectures=arm64-v8a"
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

If Windows hits a path-length error during the native build, map the project to a short drive letter and build from there:

```powershell
cmd /c "subst Y: %CD%"
Y:
.\android\gradlew.bat -p android :app:assembleRelease "-PauthAppLinkHost=uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io" "-PreactNativeArchitectures=arm64-v8a"
```

Verify Android App Links for the installed app:

```bash
adb shell pm verify-app-links --re-verify com.example.icpmobileauth
adb shell pm get-app-links com.example.icpmobileauth
```

The expected host state is:

```text
uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io: verified
```

If the phone has not enabled the verified link for this build, enable it for testing:

```bash
adb shell pm set-app-links-allowed --user 0 --package com.example.icpmobileauth true
adb shell pm set-app-links-user-selection --user 0 --package com.example.icpmobileauth true uu46p-iaaaa-aaaak-qy3lq-cai.raw.icp0.io
```

Launch the app:

```bash
adb shell monkey -p com.example.icpmobileauth 1
```

Expected login flow:

1. The app shows a loader while checking SecureStore.
2. If there is no valid delegation, it opens the hosted `/mobile-auth` page automatically.
3. Tap `Continue with Internet Identity`.
4. Sign in at `id.ai`.
5. Android Chrome may ask whether to continue to `ICP Mobile Auth`; tap the confirmation button if it appears.
6. The app returns to the native screen and shows the principal, delegation expiration, ICP receive principal, balance, and transfer controls.

To reset the app session on the test phone:

```bash
adb shell pm clear com.example.icpmobileauth
```

## Running The Mobile Auth Page

For a production-style local test:

```bash
npm install
npm run build:mobile-auth
npm run auth:server
```

The auth page is served at:

```text
http://localhost:8787/mobile-auth
```

For an Android device on the same Wi-Fi, you can avoid Cloudflare and point the app directly at your computer:

```bash
EXPO_PUBLIC_AUTH_FRONTEND_URL=http://<YOUR_COMPUTER_LAN_IP>:8787
```

The included `app.json` enables Android cleartext traffic so the development build can call the local `http://` one-time code exchange endpoint. This is for local development only; production should use a stable HTTPS origin and should not rely on a temporary LAN IP. Changing this auth origin changes the Internet Identity client origin and can change the derived user principal.

If the phone is connected by USB and LAN access is blocked by firewall rules, you can use Android port reverse instead:

```bash
adb reverse tcp:8787 tcp:8787
EXPO_PUBLIC_AUTH_FRONTEND_URL=http://127.0.0.1:8787
```

For a production-style device test, expose the auth server over HTTPS with a stable reachable host and set `EXPO_PUBLIC_AUTH_FRONTEND_URL` to that origin. The one-time code exchange routes are:

```text
POST /mobile-auth/store/<state>
POST /mobile-auth/exchange/<state>/<code>
```

`/mobile-auth/store/<state>` is called by the web page after Internet Identity returns a delegation. It stores the chain for 60 seconds under a random code. `/mobile-auth/exchange/<state>/<code>` is called by the React Native app, returns the delegation once, and deletes it. The local Node server also accepts the older JSON-body routes for development compatibility.

The included server is an in-memory reference implementation for a single deployment process. For production, run it behind HTTPS on the same stable auth origin and replace the in-memory map with a canister or backend TTL store if you deploy more than one instance.

For development only, `EXPO_PUBLIC_MOBILE_AUTH_RETURN_MODE=direct` returns the delegation JSON in the deep link as `delegation=<base64url json>`. Do not use direct return in production.

## Mainnet Auth Canister

This repo includes a Motoko HTTP canister named `mobile_auth`. It serves:

```text
/mobile-auth
/mobile-auth/assets/...
/.well-known/assetlinks.json
/auth-callback
POST /mobile-auth/store/<state>
POST /mobile-auth/exchange/<state>/<code>
```

Build the canister assets before deploying:

```bash
npm run build:auth-canister
```

Deploy to mainnet after `dfx` is installed and your local identity has cycles:

```bash
npm run deploy:auth-canister:ic
dfx canister id mobile_auth --network ic
```

Then copy the returned canister ID into `.env` using the `raw.icp0.io` values shown above, rebuild the Android app with `EXPO_PUBLIC_AUTH_APP_LINK_HOST=<AUTH_CANISTER_ID>.raw.icp0.io`, and reinstall it on the phone so Android can verify the App Link.

`scripts/generate-auth-canister-assets.mjs` generates `/.well-known/assetlinks.json`. For the current debug build it can use `android/app/debug.keystore`; for production replace `ANDROID_SHA256_CERT_FINGERPRINTS` with the release key or Play App Signing SHA-256 before running `npm run build:auth-canister`.

No `.com`, `.io`, or other custom domain is required for this path. The verified host is:

```text
<AUTH_CANISTER_ID>.raw.icp0.io
```

The canister ID is not known until the first mainnet create/deploy, so App Link verification is a two-step process:

1. Deploy `mobile_auth` and get the canister ID.
2. Rebuild/redeploy both the canister assets and the Android app using `<AUTH_CANISTER_ID>.raw.icp0.io`.

This demo uses `raw.icp0.io` because the simple Motoko HTTP canister serves uncertified static assets. For a hardened production deployment, add certified HTTP assets or put a stable custom HTTPS domain in front of the auth canister, then rebuild the app and redeploy `/.well-known/assetlinks.json` for that exact host.

To fund deployment, do not send ICP to a shared or third-party address. Send ICP to your own local `dfx` identity or use the NNS/cycles flow, then convert/top up cycles for this canister. Once `dfx` is installed, use:

```bash
dfx ledger account-id --network ic
```

That prints the ledger account controlled by your local `dfx` identity.

## Testing On A Real Device

Use a development build or standalone build:

```bash
npm install
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

Expo Go is not preferred for this flow because custom URL schemes, SecureStore behavior, and native browser auth-session behavior are closest to production in a development build or standalone build.

For local replica development, `HttpAgent.fetchRootKey()` is only called behind `__DEV__` and only for local hosts. The app does not use `blsVerify: () => true`; that shortcut disables certificate verification and is not production-safe.

For Android App Links, check verification on the connected device with:

```bash
adb shell pm verify-app-links --re-verify com.example.icpmobileauth
adb shell pm get-app-links com.example.icpmobileauth
```

The `/mobile-auth` page is intentionally a minimal branded bridge. It opens in
the in-app auth session, shows one `Continue with Internet Identity` button, and
only opens `id.ai` after that tap. On Android Chrome Custom Tabs, the async
handoff after the one-time-code store can still require the page fallback button.
The page therefore uses an explicit package `intent://` URL for Android and
shows `Open app` if Chrome blocks the automatic app handoff.

## ICP Ledger

After login, the app displays an `ICP Ledger` panel. It uses the authenticated `DelegationIdentity` to query and transfer through the real ICP Ledger canister:

```text
ryjl3-tyaaa-aaaaa-aaaba-cai
```

The receive field is the default ICRC-1 account owner principal for the logged-in identity. The app queries `icrc1_balance_of` and `icrc1_fee`, then sends with `icrc1_transfer` only after a native confirmation dialog. These are real mainnet ICP transfers; verify the recipient principal carefully before confirming.

The Cloudflare URL used during local testing is only a temporary HTTPS tunnel to the local `/mobile-auth` server. Use a stable production domain or frontend canister origin before relying on balances or receive principals long term, because Internet Identity principals are origin scoped.

## Flow Summary

1. React Native creates `Ed25519KeyIdentity.generate()`.
2. React Native exports `identity.getPublicKey().toDer()` as base64url.
3. On launch, React Native restores the SecureStore session. If no valid
   delegation exists, it automatically opens:

```text
https://<AUTH_FRONTEND_CANISTER_OR_DOMAIN>/mobile-auth?sessionPublicKey=...&redirectUri=<app-callback>&state=...&provider=ii
```

4. `/mobile-auth` shows a minimal branded bridge page.
5. The bridge button opens Internet Identity at `https://id.ai/?feature_flag_guided_upgrade=true#authorize`.
6. The page listens for `authorize-ready` and posts `authorize-client` with the session public key.
7. Internet Identity returns `authorize-client-success` with the signed delegation chain.
8. The page stores the delegation under a short one-time code and redirects to the
   configured app callback:

```text
icpmobileauth://auth-callback?state=<state>&code=<one_time_code>
https://<verified-app-link-host>/auth-callback?state=<state>&code=<one_time_code>
```

9. React Native validates `state`, exchanges the code, constructs `DelegationIdentity`, creates an `HttpAgent`, and can call a canister.

## Key Files

- `src/auth/icpAuthService.ts`: login, code exchange, restore, logout, `HttpAgent`
- `src/auth/sessionStorage.ts`: SecureStore persistence
- `src/auth/deepLinking.ts`: callback parsing and state-bearing result handling
- `src/icp/sampleActor.ts`: sample actor creation and authenticated call
- `src/icp/icpLedger.ts`: real ICP Ledger ICRC-1 balance and transfer calls
- `src/screens/LoginScreen.tsx`: mobile UI
- `mobile-auth/src/main.ts`: Internet Identity auth page
- `mobile-auth/server.mjs`: one-time code exchange server
