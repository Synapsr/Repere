# Native previews and annotations

## Model

A reverse proxy serves a website from a temporary origin separate from the application. An iframe displays that document in the reviewer's browser. An injected annotation bridge follows elements, navigation and points.

The implementation is independent. It does not contain proprietary Markup.io code or claim to reproduce every site-specific adaptation of another product.

## Opening a session

1. A reviewer verifies their email and opens a project link.
2. `POST /api/reviews/:token/preview` checks identity, HTTP origin, active link, project type and quota.
3. The backend calls `POST /__repere/sessions` at `PROXY_INTERNAL_URL`, passing only `PROXY_SECRET` and `{url, projectId, userId}`.
4. The proxy validates the destination and permitted initial redirects. It creates a bounded session, a random 192-bit subdomain and an independent message channel.
5. The backend validates the response and saves the canonical URL under the project lock. It rechecks permissions if the link or archive state changed during creation.
6. The application opens the returned iframe URL. The browser loads the website and its resources through that preview origin.

A session hostname is a temporary access capability. Share the application's review link, not the preview URL. The proxy has no access to MySQL, private PDFs, SMTP credentials or the application's login cookie.

## Page transport

Paths, query strings, methods and bodies are preserved. The upstream `Host` identifies the website; `Origin` and `Referer` are adapted when they refer to the preview. Connections use validated numerical addresses, including TLS/SNI WebSocket connections.

HTML is decompressed under a size limit, parsed with parse5 and serialized. Same-origin absolute URLs in attributes and styles are adapted; relative URLs stay relative. Embedding restrictions and incompatible CSP are replaced with the application's `frame-ancestors` policy. Escaped JSON configuration and the bridge are inserted at the beginning of `head`.

Stylesheets are also decoded under a size limit and same-origin resource URLs are adapted, including fonts. Integrity attributes are removed when rewriting could change the corresponding bytes. **JavaScript files keep their original bytes.** The bridge adapts same-origin URLs through necessary native APIs: `fetch`, XHR, history, DOM URL properties/attributes and WebSocket. Third-party HTTPS resources remain direct and retain their CORS rules.

Binary responses, byte ranges and SSE are streamed. The proxy is not a general-purpose gateway to arbitrary origins. An HTTP navigation to another origin shows an explicit external link; ordinary external links open in a separate tab. Initial canonical redirects can establish the project origin before annotations; later comment URLs must match that origin.

## Cookies and isolation

Each session receives a distinct origin. Website cookies stay **in the reviewer's browser**, without a shared server-side cookie jar. `Set-Cookie` headers are adapted to the preview host with `SameSite=None; Secure; Partitioned`, while preserving attributes such as `HttpOnly`, path and expiry. The bridge also adapts `document.cookie` writes.

The application uses an HTTP-only `__Host-repere_session` cookie on HTTPS: `Secure`, `Path=/`, and no `Domain`. Supporting browsers reject attempts by a sibling preview to plant that cookie for a parent domain. The application ignores the unprefixed legacy session cookie on HTTPS and requires its exact Origin for mutations. Ports do not isolate cookies. Random preview hostnames remain distinct from the application hostname; production requires HTTPS and a wildcard certificate. For example, `app.repere.dev` and `<session>.repere.dev` can share a gateway while `repere.dev` serves the separate website. See [deployment](DEPLOYMENT.md).

Partitioning and cookie restrictions depend on the browser and HTTPS context. Personal sessions on the original site are not imported. Successful sign-in on one site does not establish compatibility with every OAuth or anti-bot flow.

## DOM bridge and points

The TypeScript protocol lives in [`shared/preview.ts`](../shared/preview.ts). `postMessage` payloads are tied to an exact origin, verified window source and session channel. The parent validates payloads because website JavaScript shares the bridge's context and remains untrusted. No message automatically saves a comment: reviewers explicitly publish their text in Repère.

Browsing is the initial mode. The bridge intercepts annotation clicks only in comment mode. A web anchor records the original URL, CSS selector, text excerpt, relative element position, document coordinates and viewport size. Pins live in a Shadow DOM component and follow the element while scrolling or resizing. Original coordinates provide a fallback when an element can no longer be matched.

The iframe sandbox permits scripts, forms, its own-origin storage, popups and downloads. It does not allow navigation of the application window. The app refuses to be embedded itself. The bridge receives pin identifiers, numbers, states and anchors, not full conversations or application secrets.

## Network and resource boundaries

- HTTP(S) only, public ports 80/443, no credentials in URLs.
- Reject loopback, private, link-local, reserved and metadata addresses in IPv4 and IPv6.
- Require all DNS answers to be acceptable, then connect to the validated numerical address to avoid an unvalidated second resolution.
- Revalidate every connection and initial redirect.
- Allow exact-host private exceptions only for development (`app` in local Compose).
- Bound session capacity/lifetime, decompressed HTML, uploads (25 MiB), network timeouts and connections.
- Use private `no-store` responses and do not forward application request headers to the website.

Filtering protects the **server proxy's** network access. Third-party requests made directly by website scripts follow the reviewer's browser protections. A reviewed site still runs its own scripts, tracking and processing; the preview is not an offline snapshot.

## Configuration

| Variable                        | Default or requirement           | Purpose                          |
| ------------------------------- | -------------------------------- | -------------------------------- |
| `PROXY_SECRET`                  | Required, at least 32 characters | Internal API authentication      |
| `PROXY_INTERNAL_URL`            | `http://preview:3001` in Compose | Address called by Next.js        |
| `PREVIEW_BASE_URL`              | `http://localhost:3001` locally  | Parent domain of session origins |
| `APP_URL`                       | `http://localhost:3000` locally  | Exact permitted parent origin    |
| `PREVIEW_MAX_SESSIONS`          | `100`                            | Concurrent temporary sessions    |
| `PREVIEW_SESSION_TTL_MS`        | `3600000`                        | Expiry, capped at one hour       |
| `PREVIEW_MAX_HTML_BYTES`        | `8388608`                        | Maximum decompressed HTML bytes  |
| `PREVIEW_ALLOWED_PRIVATE_HOSTS` | Empty in production              | Exact development exceptions     |
| `PREVIEW_BRIDGE_PATH`           | Compiled file inside the image   | Internal bridge path             |

Sessions live in memory on one instance. Restarting invalidates them; conversations persist in MySQL. Rotating a link or archiving prevents new unauthorized writes, but an already opened preview can continue until expiry. Set capacity according to traffic and host limits.

## Compatibility

Test representative staging URLs. Deliberately limited rewriting cannot resolve all uses of `location.hostname`, absolute JavaScript redirects, domain keys, service workers, third-party CORS or cross-domain authentication. Pins cannot enter cross-origin iframes or closed shadow roots. A substantially changed page can move a fallback anchor.

Read [the testing guide](TESTING.md) and [verification record](VERIFICATION.md) to distinguish repeatable fixtures from observations on public sites.

## References

- [Same-origin policy — MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [HTTP cookies — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying)
