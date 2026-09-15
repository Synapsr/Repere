# Verification record

This page records observed checks, not compatibility promises. Test instructions are in [TESTING.md](TESTING.md).

## Bounded preview opening — after 0.1.0

Four focused scenarios passed in Chromium and Firefox (5.2 seconds, no OTP or production account writes). A stalled API and a silent frame both reach the error state within the single 25-second opening deadline. Frame reloads cannot extend it; retry recovers; late responses and reloads after a successful handshake do not trigger a false timeout. English and French messages and the original-site link were verified.

The standard production Docker image compiled successfully with this correction. This section describes the subsequent source revision; the originally published 0.1.0 image predates the correction.

## Docker Hub 0.1.0 — 15 September 2026

Version **`0.1.0` was published** to [Docker Hub](https://hub.docker.com/r/synapsr/repere) from the frozen source revision [`ef36f020b83851bc1430e83f901c7286e0cae7df`](https://github.com/Synapsr/Repere/commit/ef36f020b83851bc1430e83f901c7286e0cae7df). Changes made to `main` after that revision are not part of this image.

The tags **`0.1.0`**, **`0.1`** and **`latest`** returned the same public multi-platform index:

```text
sha256:860000ef8c3ce45f40aff05aacf33935eec7fc4bf4cae1fb83152e83558221fa
```

| Platform      | Published image manifest                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `linux/amd64` | `sha256:a7d430e110e25eec4e78381fa2623efb0349824648f9ab8bb54267d90cf32081` |
| `linux/arm64` | `sha256:b698de4148a221fb4ebf4e4c932c74ba481c6d252d57a8f55ad9e19d531c85ae` |

- Both variants were built from a clean Git archive of that revision, with the revision/version labels, provenance and SBOM attestations. No local environment file was in the build context.
- **Both final variants started with integrated MySQL 8.4.11** on fresh disposable volumes, applied migrations creating nine tables, reached Docker's healthy state and returned HTTP 200 from `/api/health`.
- The corrected healthcheck bundled in each final variant returned exit code 0. Node reported `x64` and `arm64`, respectively. AMD64 ran under Docker Desktop emulation on the ARM64 host; this was a functionality check, not a native-server performance test.
- Anonymous registry requests returned HTTP 200 and the expected digest for all three tags, with both platform manifests and two attestation manifests present.
- **Anonymous Docker pulls succeeded for AMD64 and ARM64** using an empty Docker client configuration, with no registry credentials. Existing local layers were reusable; registry access and the returned index were verified publicly.
- The two disposable smoke containers stopped successfully in 1.76 and 1.01 seconds and were removed with their anonymous data volumes. Existing test or production data was not changed by these smoke checks.

### Integrated database persistence

A separate audit used the preceding ARM64 build (`sha256:5ec6b0f629c14c0e007cb7e98dcdad357fb2498d0799f4cec05f50df3d89cf96`) before the healthcheck correction was bundled:

- A real local Mailpit OTP authenticated a reviewer. A PDF project, named comment and page-two anchor were created; downloaded PDF bytes matched the upload.
- After stopping and recreating the container with the same environment and named `/data` volume, the authenticated session, owner, project, comment, author, anchor and PDF bytes were preserved.
- `/data/secrets.json` stayed byte-identical, owned by root with mode `0600`. MySQL reused its existing data directory. Shutdown completed in 1.169 seconds with exit code 0, a clean MySQL shutdown and no OOM kill.
- MySQL, the application and preview service accepted only loopback traffic inside the container; gateway 8080 was the sole published port. MySQL X was absent.
- The app user could read uploads but not the MySQL directory or persisted secrets. Preview and gateway users could not read uploads, MySQL data or secrets.

That older image exposed the faulty gateway healthcheck. The fix was exercised against both integrated and external database containers, then included in the final published image whose two-architecture startup checks are recorded above. The persistence round trip and the final image smoke checks are separate pieces of evidence.

### Production checks still outstanding

A production email-send test was accepted by the configured SMTP service; **receipt in the destination inbox has not been confirmed**. At the time of this record, **wildcard TLS for `*.preview.repere.dev` was not configured**. Local HTTPS isolation tests use a test certificate and do not establish public DNS, certificate issuance, renewal or successful production preview access.

## Production container startup and HTTPS isolation — 15 September 2026

- **128 unit/HTTP tests passed** across 16 files, including the gateway health-check regression test. TypeScript, ESLint and Prettier passed.
- The all-in-one ARM64 image completed **28 API/browser scenarios in 47.9 seconds** against external MySQL and real SMTP captured by Mailpit, with Chromium and Firefox.
- **Two additional real-HTTPS browser scenarios passed** in Chromium and Firefox using a local TLS relay and CONNECT proxy. The browser rejected sibling-domain attempts to plant a protected `__Host-` session cookie. Legacy unprefixed cookies were ignored, including one carrying a valid session token. Authenticated sibling-origin mutations returned 403; private responses were unreadable through CORS; the preview could not read the parent document.
- These HTTPS tests use real transport, not intercepted browser response fulfillment. No public SMTP messages were sent.

The standard application image also started against a fresh external MySQL database, applied one migration creating nine tables, and reapplied startup without duplicating the migration. A real PDF upload returned 201 and the downloaded bytes matched. The uploads directory uses UID 1001 and mode 700; PDF files use mode 600. A SIGTERM stopped the application in 437 milliseconds without forced termination.

The publication section above records the released image. These local integration checks did not validate production wildcard TLS.

## Invitation guide and feedback controls — 15 September 2026

The application revision includes automatic OTP submission on paste, native comment cursors and the first-visit invitation guide. The public repository contains the application and its deployment stack.

- **94 unit/HTTP tests passed** across 11 files, including application-only language-origin checks.
- **28 browser/API scenarios passed in one 32.8-second run:** 8 API, 10 Chromium and 10 Firefox. The original flows use real MySQL and SMTP; dedicated clipboard and onboarding cases intercept their page-level data boundaries to exercise UI state without consuming OTP quotas.
- TypeScript, ESLint, Prettier and the production Docker build completed successfully. The dependency installation reported zero audit vulnerabilities, including development dependencies.
- Clipboard checks covered complete, incomplete and malformed pasted codes, duplicate events, recoverable errors and manual retry. Firefox's synthetic clipboard-event restriction is handled in the test fixture, not in application code.
- The website cursor image decoded in both browsers. It changed after placement, reset after cancellation/publication, and restored the site's text/link cursors in Browse mode.
- The invitation guide passed first-guest display, dismissal and reload persistence, manual replay, owner/PDF/archive exclusions, Escape, reduced motion and unavailable local storage. The real invited-reviewer journey also dismissed the guide and continued to comments.
- Desktop and mobile invitation-guide captures were visually inspected, including the static reduced-motion presentation.

These results do not validate public DNS, TLS or external SMTP. GitHub Actions runs are recorded separately by the repository's [CI workflow](https://github.com/Synapsr/Repere/actions/workflows/ci.yml).

## Release presentation and localization refresh — 15 September 2026

The release revision adds the English/French interface, compact review layout and updated visual design. The complete integration suite passed against the final production Docker image, including the PDF rendering correction.

| Check                                                       | Observed result                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e`                                          | **18 passed in 26.6 seconds:** 8 API, 5 Chromium and 5 Firefox scenarios                                             |
| `npm run format:check`, `npm run typecheck`, `npm run lint` | All completed with exit code 0                                                                                       |
| Unit and HTTP tests                                         | **93 passed** in the preceding release validation run                                                                |
| `npm audit`                                                 | **Zero vulnerabilities**, including development dependencies, after validating the targeted Drizzle tooling override |
| Production Docker images                                    | Builds completed and services reported healthy                                                                       |

The integration suite uses the actual Docker MySQL database, SMTP delivery through Mailpit and native browser previews. It covers identity and permissions, saved comments and replies, sharing, archive, website navigation and isolation, ordinary and scanned PDFs, mobile framing and localization.

- Real French/English OTP emails and stable API error codes passed. Switching from a French browser preference to English retained the current website page, live preview session, counter state and unsent comment; the saved language remained English after reload.
- Chromium and Firefox verified PDF page changes, zoom, point persistence and scanned-page rendering. Additional direct checks confirmed that selecting a comment on the displayed page caused no redraw or loading indicator, and entering `02` on page 2 did not leave rendering stuck.
- Eight direct mobile checks found no cropping or horizontal overflow; the integration scenarios also verify the narrow preview frame.
- Manual inspection of Lumy's Nuxt website confirmed the 60-pixel review header, navigation to a comment's page and point, and language changes without losing the draft, preview session or current page. Comments remained local to Repère and did not modify the original site.
- The README screenshots were captured from the running English interface. The PDF screenshot shows a rendered second page of the included [example document](examples/brand-guidelines.pdf).
- The dependency-free setup script ran in an isolated temporary directory without `node_modules`. A second run preserved the exact environment contents and mode `0600`.
- Documentation links resolved locally; a scan of the files eligible for the initial commit found no values from the local secret environment. Upload directories, environment files and browser traces are ignored.

These are results for this earlier revision. The baseline below describes a different interface revision and is retained as transport and packaging evidence.

## Baseline checks — 15 September 2026

These checks were performed on the initial native-preview implementation before the release presentation/localization refresh.

### Environment

- macOS, Docker Compose and Node.js 24 images.
- Next.js 16.3.5, React 19.3.0 and TypeScript 6.0.3.
- MySQL 8.4, Drizzle 0.45.2 and actual SMTP captured by Mailpit.
- Separate `.localhost` preview subdomains.
- Chromium and Firefox through Playwright 1.63.0, with an additional manual browser inspection.

### Repeatable evidence

**65 unit/HTTP tests** passed. **15 distinct integration scenarios** (7 API and 8 UI across Chromium/Firefox) were validated in bounded runs. Strict type checking, ESLint and Prettier checks also passed at that point.

| Area                | Observed checks                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Installation        | Images built, migrations applied and reapplied with data retained, healthy services                                     |
| Identity and access | Delivered OTPs, incorrect/reused/concurrent codes, quotas, logout, owner/guest permissions, mutation protection         |
| Persistence         | Concurrent numbering, authors, replies, counters, resolve/reopen, link rotation and archive                             |
| Proxy               | DNS/IP, redirects, session origins, HTML/CSS URLs, unchanged JavaScript, POST, cookies, byte ranges, SSE and WebSockets |
| Next.js fixture     | Hydration, links, counter, form, tabs and history executed natively                                                     |
| Review              | Element/page anchor, reload restoration, guest replies and statuses                                                     |
| Isolation           | No app cookie in iframe requests, inaccessible parent DOM, separate website cookies, malformed messages ignored         |
| PDF                 | Two pages, page-two point, zoom, reload and owner reading after archive                                                 |
| Mobile              | 390-pixel screen, no app overflow and visible point                                                                     |
| Distribution        | No browser executable in preview image; required asset and bundled-dependency notices present                           |

Cookie isolation checks inspect **actual transmitted headers**. Playwright's `context.cookies(url)` filter can include localhost entries that the browser does not send to another-host iframe.

The demo fixture exposes a hydration marker. Tests await it before clicking because server-rendered controls can appear before their scripts load; a single click must produce exactly one update.

### Scanned PDFs and auxiliary assets

An original synthetic CCITT PDF loaded `jbig2.wasm` with HTTP 200. Chromium and Firefox verified a black center pixel and a white corner pixel on the rendered canvas. A separate check rendered the same document using the JavaScript fallback. The 186 copied PDF.js files were compared with their pinned upstream originals.

JPEG2000 decoders, CMaps, Symbol/Dingbats fonts and ICC profiles are also distributed. Their presence is not evidence that every PDF encoding variation has been exercised.

### Public site: Lumy / Nuxt

`https://lumy.studio/fr` was compared directly and through Repère in Chromium and Firefox.

- Nuxt hydration was observed at approximately 1.3 and 3.3 seconds during the last pass.
- Expected typography, heading and content were present.
- Native selection of 59 characters and approximately 650 pixels of scrolling worked.
- The JavaScript menu opened and closed.
- Navigation to `/fr/le-studio` remained inside the preview and updated the original page address.
- No page, console, request or HTTP-status errors were observed during those flows.

Manual inspection also created a comment **only in Repère**, checked its position on a heading word at narrow width, and restored the correct page and pin after a full reload. No public-site form was submitted.

## Scope

These checks do not cover every website or PDF. Production wildcard domains, certificates, confirmed email receipt and deployment-specific cookie behavior still require verification on the actual host. OAuth, third-party CORS and scripts tied to their original domain may require compatibility work.

Public-site timings are individual observations, not a benchmark or performance guarantee. Docker Hub publication is explicitly recorded above; local test results do not imply a completed public application deployment or a hosted CI result.
