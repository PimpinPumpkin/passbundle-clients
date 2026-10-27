# Web Connectors

Small pages the web vault serves for steps that run outside the app: a security key, Duo, and
single sign-on. They read their inputs from the address, so anyone can open or frame them with
inputs of their choosing. PassBundle's rules for them (DESIGN.md, "Connector pages"):

- A connector sends what it learns only to the web vault's own origin or to PassBundle's own
  browser extension (`isAllowedOrigin()`, `common.ts`). Upstream trusted any `parent` named in the
  address on a self-hosted server, so a page anywhere could frame the security key connector and
  receive the key's answer.
- PassBundle's extension origins come from `brand/brand.json` (`extension.chromiumId`), which
  `brand/apply.mjs` writes into `keykeeper-origins.ts` at build time. An unbranded build answers
  the web vault only.
- The server sends every connector page with a policy of its own: `default-src 'self'`,
  `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'self'` plus
  PassBundle's extension origins. Other sites can't frame one at all, and it loads only its own
  files.
- Upstream's deep links back to its mobile and desktop apps (`bitwarden://...-callback`,
  `https://bitwarden.com/...-callback`) are gone: PassBundle's own apps don't use these pages.

## WebAuthn Flow

Two pages:

- `webauthn-connector.html` (`webauthn.ts`, template `webauthn.html`): a frame on the web vault's
  two-step login page.
- `webauthn-fallback-connector.html` (`webauthn-fallback.ts`, template `webauthn-fallback.html`): a
  tab of its own, which the browser extension opens.

Both share `common-webauthn.ts` for credential parsing (`parseWebauthnJson()`) and assertion
serialization (`buildDataString()`).

### Web Vault Frame

The `WebAuthnIFrame` class (`libs/common/src/auth/webauthn-iframe.ts`) frames the connector.

1. `WebAuthnIFrame.init()` embeds `webauthn-connector.html` with `allow="publickey-credentials-get <origin>"`, passing `data` (base64 JSON), `parent` (the embedding page's URL), `btnText`, `btnAwaitingInteractionText`, and `v=1`
2. The connector takes the parent's origin only when it is the web vault's own origin or PassBundle's extension (`allowedParentOrigin()`), and only when every page around it is one of those, where the browser lists them (`framedOnlyBy()`, from `location.ancestorOrigins`). Firefox doesn't list them; there the page that loaded the frame (`document.referrer`) must be on the parent's origin, and a frame without a referrer gets nothing
3. Otherwise it refuses: no security key prompt, no message, and a page that says so
4. It sends `info|ready`, then `success|<data>` or `error|<message>`, with `postMessage` to that origin only, never `*`
5. It takes `stop` and `start` only from its parent window at that origin
6. `WebAuthnIFrame.parseMessage()` accepts messages only from the connector's origin

### Browser Extension Tab

The extension never frames a connector: `ExtensionTwoFactorAuthWebAuthnComponentService` opens
`webauthn-fallback-connector.html` in a new tab.

1. `webauthn-fallback.ts` asks no security key inside any frame
2. The user clicks "Read security key", and `navigator.credentials.get({ publicKey })` runs on the vault's own origin
3. On success it sends `window.postMessage({ command: "webAuthnResult", data, remember }, window.location.origin)` to its own window
4. The extension's content script (`content-message-handler.ts`) forwards it to the background, which checks the referrer is a known vault (`isValidVaultReferrer()`, `runtime.background.ts`) and opens the two-step login popout with the answer

The server refuses every answer made in a frame that isn't on the vault's own origin
(clientDataJSON `crossOrigin: true`, or any `topOrigin`), whatever page asked for it. No
PassBundle flow makes one: the web vault frames its own connector, and the extension uses a tab.

## Duo Flow

The Duo connector is `duo-redirect-connector.html` (source: `duo-redirect.ts`, template:
`duo-redirect.html`). It serves two purposes:

1. **Frameless redirect:** When loaded with a `duoFramelessUrl` query param, validates the URL
   against strict security rules and redirects to Duo's OAuth authorize endpoint
   (`duo-redirect.ts`). Validation requires: hostname matching
   `/^api-[a-zA-Z0-9]+\.(duosecurity|duofederal)\.com$/`, HTTPS protocol, no embedded credentials,
   no custom ports, and pathname `/oauth/v1/authorize`.
2. **Result dispatch:** When Duo's OAuth flow completes, the callback returns to
   `duo-redirect-connector.html` with `client`, `code`, and `state` query params. The connector
   hands the result to the web vault or the extension, on its own origin only. Any other `client`
   gets nothing.

Both construct a 2FA token as `code|state` (`Duo2faResult.token`), submitted via
`loginStrategyService.logInTwoFactor()`.

### Web App Callback

1. Web app launches Duo `AuthUrl` (from `providerData.AuthUrl`) in a new window; the server-provided `redirect_uri` includes `client=web`
2. User completes Duo 2FA in the new window
3. Duo redirects to `duo-redirect-connector.html?client=web&code=...&state=...`
4. Connector sends `{ code, state }` via `new BroadcastChannel("duoResult")` and closes the channel (`duo-redirect.ts`)
5. `WebTwoFactorAuthDuoComponentService` (`apps/web/src/app/auth/core/services/two-factor-auth/web-two-factor-auth-duo-component.service.ts`) listens on the same `BroadcastChannel("duoResult")` and maps the message to a `Duo2faResult`
6. Connector displays a handoff message with a 5-second auto-close countdown and close button (`duo-redirect.ts`)

### Browser Extension Callback

1. Extension opens a 2FA popout (`openTwoFactorAuthDuoPopout()`, `auth-popout-window.ts`) and navigates to `duo-redirect-connector.html?duoFramelessUrl=<encoded-duo-auth-url>&handOffMessage=<encoded-json>` (`extension-two-factor-auth-duo-component.service.ts`)
2. Connector validates the Duo URL and redirects to Duo (`duo-redirect.ts`)
3. After Duo auth, callback returns to `duo-redirect-connector.html?client=browser&code=...&state=...`
4. Connector sends `window.postMessage({ command: "duoResult", code, state }, window.location.origin)` (`duo-redirect.ts`)
5. Content script (`content-message-handler.ts`) picks up the `duoResult` message and forwards it via `chrome.runtime.sendMessage()` to the extension
6. `ExtensionTwoFactorAuthDuoComponentService.listenForDuo2faResult$()` receives the message through the extension's messaging system and maps it to a `Duo2faResult` (`extension-two-factor-auth-duo-component.service.ts`)
7. Connector displays a "you may close this window" handoff message (`duo-redirect.ts`)

## SSO Flow

Unlike the Duo and WebAuthn connectors — which act as intermediaries for all clients including
mobile — the SSO connector (`sso-connector.html` / `sso.ts`) is only used by **web** and
**browser extension**. Desktop and CLI receive IdP callbacks directly via deep link or localhost
HTTP server, bypassing the connector entirely.

All clients share a common `SsoComponent` (`libs/auth/src/angular/sso/sso.component.ts`) hosted on
the web vault that handles org identifier input and IdP redirect. The callback path after IdP
authentication diverges per client based on the `redirect_uri` registered with IdentityServer.

### Web App Callback

The web app sets `redirect_uri` to `{webVaultUrl}/sso-connector.html` (hardcoded in the `SsoComponent` constructor, `sso.component.ts`).

1. After IdP authentication, IdentityServer redirects to `sso-connector.html?code={code}&state={state}`
2. `sso.ts` loads and calls `initiateWebAppSso()` (state does not contain `:clientId=browser`)
3. If `state` contains a `_returnUri`, the user is redirected to that URI; otherwise, redirected to `/#/sso?code={code}&state={state}`
4. `SsoComponent.ngOnInit()` detects `code` + `state` in query params via `userCompletedSsoAuthentication()`
5. Retrieves `codeVerifier` and pre-login `state` from `SsoLoginService`
6. Validates state matches, exchanges code for token via `loginStrategyService.logIn()` with `SsoLoginCredentials`

### Browser Extension Callback

The browser extension also sets `redirect_uri` to `{webVaultUrl}/sso-connector.html` (`extension-login-component.service.ts`), but appends `:clientId=browser` to the `state` (`default-login-component.service.ts`) so the connector can distinguish it from a web login.

1. After IdP authentication, IdentityServer redirects to `sso-connector.html?code={code}&state={state}`
2. `sso.ts` detects `:clientId=browser` in the state and calls `initiateBrowserSso()`
3. `initiateBrowserSso()` calls `window.postMessage({ command: "authResult", code, state })` targeting the page's own origin
4. The browser extension's content script (`content-message-handler.ts`) picks up the `authResult` message and forwards it via `chrome.runtime.sendMessage()` to the background service worker
5. Background handler (`runtime.background.ts`) validates the referrer is a known vault URL via `isValidVaultReferrer()`
6. On success, opens an SSO popout window at `popup/index.html#/sso?code={code}&state={state}` via `openSsoAuthResultPopout()` (`auth-popout-window.ts`)
7. The extension's `SsoComponent` instance completes the token exchange

### Desktop App Callback (bypasses sso-connector.html)

Desktop has two callback mechanisms, selected based on platform support (`desktop-login-component.service.ts`):

**Deep link (default):** Uses `bitwarden://sso-callback` as the `redirect_uri` (the `DESKTOP_SSO_CALLBACK` constant exported from `sso-url.service.ts`).

1. After IdP authentication, IdentityServer redirects to `bitwarden://sso-callback?code={code}&state={state}`
2. OS intercepts the custom protocol URL and routes it to Electron
3. `processDeepLink()` in `app.component.ts` parses the URL, extracts `code` and `state`
4. Sends a `ssoCallback` message via `messagingService`
5. `app.component.ts` handles `ssoCallback`, navigates to the `["sso"]` route with `code`, `state`, and `redirectUri` as query params
6. Desktop's `SsoComponent` instance completes the token exchange

**Localhost HTTP server (fallback for AppImage / dev):** Uses `http://localhost:{port}` as the `redirect_uri`, managed by `sso-localhost-callback.service.ts`.

1. Starts an HTTP server trying ports 8065–8070 (`sso-localhost-callback.service.ts`)
2. Sets `redirect_uri` to `http://localhost:{port}` and opens the web vault SSO URL in a browser
3. After IdP authentication, IdentityServer redirects to `http://localhost:{port}?code={code}&state={state}`
4. Localhost server receives the request, validates state, sends a `ssoCallback` message
5. Flow continues identically to the deep link path from step 5 above

### CLI Callback (bypasses sso-connector.html)

The CLI uses a localhost HTTP server exclusively (`login.command.ts`).

1. Starts an HTTP server trying ports 8065–8070
2. Sets `redirect_uri` to `http://localhost:{port}`
3. Calls `SsoUrlService.buildSsoUrl()` and opens the resulting web vault URL in a browser
4. User completes org identifier entry and IdP authentication on the web vault
5. After IdP authentication, IdentityServer redirects to `http://localhost:{port}?code={code}&state={state}`
6. Localhost server receives the request, validates state, extracts the org identifier from state (via `_identifier=` suffix)
7. CLI exchanges code for token via `loginStrategyService.logIn()` with `SsoLoginCredentials`
