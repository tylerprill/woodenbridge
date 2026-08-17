# Content Security Policy operations

Field Atlas uses an enforced, per-request nonce policy for every HTML document.
The proxy generates 128 random bits, forwards the nonce and policy to the App
Router, and returns the same policy to the browser. Next.js then adds the nonce
to its framework, page, and inline bootstrap scripts.

Production `script-src` is:

```text
script-src 'self' 'nonce-<per-request-value>' 'strict-dynamic'
```

It contains neither `'unsafe-inline'` nor `'unsafe-eval'`, and
`script-src-attr 'none'` blocks event-handler attributes. Development adds only
`'unsafe-eval'`, which Next.js and React require for debugging.

## Rendering decision

The bundled Next.js 16 CSP guide states that request nonces require dynamic
rendering. Static generation, ISR, CDN document caching, and Partial
Prerendering cannot attach a fresh request nonce. Next's experimental SRI mode
can preserve static generation, but it is explicitly experimental and cannot
cover dynamically generated scripts.

The stable nonce path is the safer choice here. Dashboard, shared chapter,
reset, verification, login, and landing-page requests were already dynamic or
request-dependent. Calling `connection()` in the root layout also makes the two
small static authentication shells request-rendered. Asset routes and Link
prefetches do not run the nonce/auth proxy, so immutable JavaScript, CSS,
images, and metadata retain their normal caching and avoid per-request crypto.

## Style policy

Style elements are limited by `style-src-elem` to same-origin files or the
request nonce. The Atlas needs a small number of React `style` attributes for
live map-tooltip coordinates and upload progress, so
`style-src-attr 'unsafe-inline'` remains intentionally scoped to attributes.
It does not weaken `script-src`, and arbitrary inline `<style>` elements remain
blocked.

## Adding browser resources

- Prefer CSS modules and same-origin assets.
- A raw inline `<script>` must read `x-nonce` with `headers()` and render the
  value as its `nonce` attribute. The website JSON-LD component is the reference
  implementation.
- Do not add `'unsafe-inline'`, a broad `https:` source, `data:` scripts, or `*`
  to `script-src`.
- Add a third-party origin only to the narrow directive that requires it, then
  extend the CSP tests.
- Never expose a nonce through application state or reuse it across requests.

The current network allowlist is limited to the same origin, OpenFreeMap tiles,
and the Vercel Blob upload endpoints. Private photos are delivered through
same-origin authorization routes.

## Verification

Run the policy and proxy contract tests:

```bash
npm test -- --runInBand \
  test/config/content-security-policy.test.ts \
  test/config/proxy-csp.test.ts \
  test/config/security-headers.test.ts \
  test/config/json-ld-nonce.test.tsx
```

For a running production build, inspect one public and one authenticated HTML
response. Every `<script>` must carry the nonce found in the response policy,
and two requests must have different nonces. API responses receive a separate
`default-src 'none'; sandbox` policy when opened as documents.

Treat CSP violation reporting as an operational integration: add a dedicated
authenticated reporting endpoint or vendor before setting `report-to`. Do not
send reports to an endpoint that is not monitored or rate limited.
