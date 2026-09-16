# Verification record

This page records observed checks, not compatibility promises. Test instructions are in [TESTING.md](TESTING.md).

## Feedback prompts 0.5.0 — 16 September 2026

Source revision [`cae2e6d`](https://github.com/Synapsr/Repere/commit/cae2e6dd68654a139f3da0c651b71a0837ab8f49) passed [CI run 35095208446](https://github.com/Synapsr/Repere/actions/runs/35095208446). Local checks and final CI cover:

- **169 unit and HTTP tests** pass. TypeScript, ESLint, formatting and dependency audit pass (zero reported vulnerabilities).
- **48 integration scenarios** pass: 12 API, 18 Chromium and 18 Firefox. The two opt-in HTTPS checks are skipped.
- Prompts preserve website URLs, selectors, point coordinates, PDF page numbers, comment text and replies in English or French. Account email fields, sharing tokens, file-storage keys and screenshot bytes are not added.
- API checks deny anonymous and share-link guest exports, follow current open/resolved state, and enforce workspace membership after project moves and member removal. Query validation, unrelated comment IDs, empty selections and archived manager access are covered.
- Both browsers exercise single/bulk copy, resolved filters, stale review data, guest visibility and automatic removal of controls after workspace access is revoked. The OS clipboard is stubbed to preserve the user's clipboard; the selected-text fallback is checked for focus and full selection.
- Mobile placement of the copy controls was visually inspected. Tests use synthetic accounts and local Mailpit; no production test email was sent.
- Existing migrations and the four invitation concurrency scenarios continue to pass. This release adds no database migration, dependency or environment variable.

### Docker publication and application deployment

Tags `synapsr/repere:0.5.0`, `0.5` and `latest` identify this verified public AMD64/ARM64 index:

```text
sha256:843c1c563c7a50d2b507251aeb173000ec38a104a4c3054e9d03fce94959536f
```

Both architectures started with integrated MySQL (13 tables, 4 migrations), exercised single/bulk prompt exports through the authenticated packaged API, and rejected anonymous exports. Existing workspace, invitation and private JPEG checks pass. Restarting preserves feedback, prompt output access and identical stored screenshot bytes. AMD64 ran under Docker Desktop emulation on an ARM64 host; these are functionality checks, not performance benchmarks.

The public runtime manifests and configurations match the tested images. Anonymous registry reads confirm both platforms, source/version labels, SLSA provenance, SPDX SBOMs and preservation of the 0.1–0.4 tags. Native image-library license inventories remain present.

The production app was deployed from the same revision after a successful MySQL backup. Startup completed, health returned 200, and unauthenticated prompt access returned 401. The preview service is unchanged. These checks do not claim a production restore or a new authenticated production browser session.

## Point screenshots 0.4.0 — 16 September 2026

Source revision [`819b8b0`](https://github.com/Synapsr/Repere/commit/819b8b04a4e753d558e6e858c7b7deb780aa79a8) passed [CI run 35085906735](https://github.com/Synapsr/Repere/actions/runs/35085906735). Local checks and final CI cover:

- **166 unit and HTTP tests** pass. TypeScript, ESLint, formatting and dependency audit pass (zero reported vulnerabilities).
- **45 integration scenarios** pass: 11 API, 17 Chromium and 17 Firefox. The two opt-in HTTPS checks are skipped. The screenshot scenario was rerun after correcting an ambiguous test selector and adding the slow-submit regression; the other browser scenarios passed in the complete run.
- Real screenshot pixels stay green after the page turns red before publishing. Stored bytes survive page reload, scrolling and site interactions. The second page of a two-color PDF remains blue in its saved image.
- Cancelled drafts create no comment. Capture runs quietly, with no draft image or status. An icon in the published comment opens the image; publishing waits for an ongoing capture and still works if capture fails. Late results cannot overwrite a new draft. A second point placed during a delayed, failed POST cannot move the retained draft's marker.
- API tests verify private image access, invalid/rotated links, archived guest restrictions, JPEG decoding, dimensions and upload limits, and unchanged counters on rejected uploads.
- Filesystem and transaction tests verify private permissions, rejection of symlinks, cleanup on transaction failure and retention after a committed write.
- Fresh MySQL installation, upgrades from 0.1.1, 0.2.0 and 0.3.0, interrupted DDL and repeat startup preserve existing data. Screenshot foreign keys and fractional/timestamp metadata are checked.
- Expanded website and PDF screenshot views were visually inspected. Synthetic test identities use local Mailpit only; no production emails were sent for these checks.

An additional real-browser fixture in Chromium and Firefox captured a 900 × 700 viewport after scrolling 620 pixels. Immediate parent resizing to 600 × 500, DOM/input/canvas changes and scrolling after the point did not alter the captured image or its point coordinates. The renderer's temporary iframe is isolated from the reviewed website's global iframe CSS.

Website captures reconstruct the live DOM; conic gradients, clipping/backdrop effects, nested frames and cross-origin media are not guaranteed to match. PDFs copy their existing canvas. These results establish the tested behaviors, not universal pixel-perfect website capture.

### Docker publication and application deployment

Tags `synapsr/repere:0.4.0`, `0.4` and `latest` identify the verified public AMD64/ARM64 index:

```text
sha256:6ac1206ee6dcb4c4d439b06fbb2c5a558fb3b903d5105e4b2535bcfb9b541620
```

Both architectures started with integrated MySQL (13 tables, 4 migrations), validated real Sharp JPEG writes and private reads through the API, and retained the same screenshot bytes after stopping and restarting their volumes. The published runtime manifests and configurations match the tested images. Anonymous registry checks confirm the tags, source revision, SLSA provenance, SPDX SBOM and preservation of the 0.1–0.3 tags. Native image-library license inventories are present in both images.

The production app and preview service were deployed from the same source revision after a successful database backup. Startup migrations completed, the application health endpoint returned 200, and unauthenticated screenshot access returned 401. No production test email was sent. These checks do not claim a production restore or a new authenticated production browser session.

## Workspace invitations 0.3.0 — 16 September 2026

Source revision [`f655468`](https://github.com/Synapsr/Repere/commit/f655468e73e61b6049345f97a91e1d3f54e1868b) passed [CI run 35080406117](https://github.com/Synapsr/Repere/actions/runs/35080406117). Local checks and final CI cover:

- **148 unit and HTTP tests** pass; ESLint, TypeScript, formatting and dependency audit pass (zero reported vulnerabilities).
- **42 integration scenarios** pass in final CI: 10 API, 16 Chromium and 16 Firefox. The two optional HTTPS checks are skipped.
- Four of the browser scenarios exercise automatic member-list refresh and stale-response handling with controlled responses and no OTP requests. The other 38 scenarios also passed locally on their first attempt.
- Real invitation email delivery through local Mailpit, email-code login, explicit acceptance, workspace project access, removal, and rejection of a previously accepted link pass in both browsers. All recipients are synthetic test identities.
- API checks cover matching-email enforcement, token hashing, owner permissions, resend, cancellation, expiry, idempotency and continued guest participation through existing shared review links.
- **Four MySQL concurrency scenarios** pass on a separate disposable database: first delivery failure, resend failure preserving the previous token, cancellation during email delivery, and acceptance/removal while a resend is pending. SMTP alone is controlled in these tests; database transactions are real.
- Fresh installation, interrupted migration and upgrades from the 0.1.1 and 0.2.0 schemas pass without losing existing projects, memberships, feedback, sharing links or sessions.
- Visual checks at 320, 390 and 1440 pixels cover owner/member views, invitation acceptance, wrong-account and unavailable/error states in Chromium and Firefox.

API and browser integration run against independent local MySQL/Mailpit stacks, using 17 and 18 OTP sends respectively. Authentication quotas remain unchanged. CI uses the same separation, with all three jobs successful.

### Docker publication

Tags `synapsr/repere:0.3.0`, `0.3` and `latest` were published from the frozen `f655468` source revision and verified through anonymous registry reads:

```text
sha256:073725dcd8d0e65003c11b3745604b2b3eb6f9d17f63c0c551200525606bc51c
```

- Both Linux AMD64 and ARM64 variants passed startup with integrated MySQL, **12 tables including the migration journal**, and three applied migrations.
- Health checks, service identities, private file permissions, workspace isolation, project moves, invitation acceptance/removal and rejected reuse of an accepted link passed. These packaging fixtures use synthetic database sessions; the separate integration journeys exercise real OTP delivery to Mailpit.
- Restart and persistence checks passed on both architectures. AMD64 was tested through Docker Desktop emulation on an ARM64 host; this is a functionality check, not a performance benchmark.
- Published runtime manifests and configurations exactly match the smoke-tested images. Both include SPDX SBOMs and SLSA provenance, with the expected version and revision labels.
- Anonymous reads confirmed the new tags and unchanged digests for `0.1`, `0.1.0`, `0.1.1`, `0.2` and `0.2.0`. Only disposable smoke containers and their own volumes were removed.

### Production deployment

The application was deployed from `f655468` after a fresh successful MySQL backup. EasyPanel reports a completed deployment, startup logs confirm migrations completed and Next.js ready, and the public health endpoint returns 200. The members endpoint requires authentication (401), and an invalid invitation returns 404. The existing signed-in production session loaded its workspace and retained its projects. SMTP, environment variables, preview routing and TLS settings were preserved. Invitation email journeys were tested with local Mailpit; no invitation was sent to a real production recipient as part of this verification.

## Workspaces 0.2.0 — 16 September 2026

Source revision [`7bf4877`](https://github.com/Synapsr/Repere/commit/7bf48770902cbb99e678e097105dc74413b7b32f) passed [CI run 35073047727](https://github.com/Synapsr/Repere/actions/runs/35073047727):

- Dependency audit, ESLint, Prettier and TypeScript checks passed.
- **133 unit and HTTP transport tests** passed across 17 files.
- **35 integration scenarios** passed on the first attempt: 9 API, 13 Chromium and 13 Firefox. Two opt-in HTTPS cookie tests were skipped in this run; their earlier dedicated validation is recorded below.
- Workspace tests cover concurrent first visits, creation order, project isolation, membership permissions, website/PDF creation, transfers preserving links and feedback, archived access and removal of a creator’s management rights after losing membership.
- Browser journeys cover creation, switching, project moves, the return to the correct space, Back/Forward, reload, remembered selection, keyboard controls, mobile overflow and late responses from a previously selected workspace.
- Disposable MySQL 8.4 tests applied the 0.1.1 migration, seeded projects and feedback, then upgraded. Existing IDs, sharing links, PDF metadata, comments, replies, attachments and sessions were preserved. An interrupted backfill resumed successfully; repeated execution and a fresh installation also passed.
- Visual and keyboard checks passed at 320, 390, 768 and 1440 pixels in Chromium and Firefox without JavaScript errors.

### Docker publication

Tags `synapsr/repere:0.2.0`, `0.2` and `latest` were published from the same frozen `7bf4877` revision and returned this index through anonymous registry requests:

```text
sha256:84650557d9c9322500bc47e48dd0c3e4cd5828468535953e1cec22d22f3f333c
```

- Both Linux AMD64 and ARM64 images started with integrated MySQL, **11 tables including the migration journal**, and two applied migrations. Health checks, service identities and volume permissions passed.
- Isolated container fixtures checked eight concurrent workspace bootstraps, stable creation order, project filtering, management rights and transfers preserving IDs and links. These packaging checks use synthetic database sessions; the integration suite above separately exercises real OTP delivery.
- The published runtime manifests exactly match the tested images. Each architecture includes provenance and an SPDX software bill of materials. Anonymous reads confirmed both platforms, source/version labels and unchanged digests for the older `0.1`, `0.1.0` and `0.1.1` tags.
- Restart and graceful shutdown checks passed. Only the disposable smoke containers and their volumes were removed.

The application was deployed with a database backup and completed its startup migrations. The existing signed-in production session retained its projects in the migrated first workspace, and an existing website opened successfully through its HTTPS preview. No deployment environment variables or proxy/TLS settings were changed for this release.

## Docker Hub 0.1.1 — 15 September 2026

Version **`0.1.1` was published** to [Docker Hub](https://hub.docker.com/r/synapsr/repere) from the frozen source revision [`8e15dded`](https://github.com/Synapsr/Repere/commit/8e15dded1c922333839022e27c1838e3154a261f). The tags **`0.1.1`**, **`0.1`** and **`latest`** returned this public multi-platform index:

```text
sha256:4701bf47e44a7ec46bc4d0e54940f9d9a51b26f9297193a9eb341740900f8e42
```

| Platform      | Published image manifest                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `linux/amd64` | `sha256:0f0a0acdb5b043fd2ecd59be9d694939df80de8bdeeab710384b3c61212a7e32` |
| `linux/arm64` | `sha256:fcd8b12de76c6f243dfbfd7738dce626c86e649b47e55a13523b371e8837e64b` |

- Both variants were built from a clean Git archive of that revision, excluding local environment files, with version/revision labels, provenance and SBOM attestations.
- **Both published variants started with integrated MySQL 8.4.11** on fresh disposable volumes. Migrations created nine tables, Docker reported healthy, `/api/health` returned HTTP 200 and the bundled healthcheck exited successfully.
- Node reported `x64` and `arm64`. AMD64 ran under Docker Desktop emulation on the ARM64 host; this is a functionality check, not a native-server performance test.
- Anonymous registry requests returned the expected index for all three tags. Both platform manifests carried source revision `8e15dded1c922333839022e27c1838e3154a261f` and version `0.1.1`; two attestation manifests were present.
- **Anonymous Docker pulls succeeded for both architectures** using an empty Docker client configuration. Existing layers were reusable; registry access and the returned digest were verified publicly.
- The disposable ARM64 and AMD64 smoke containers stopped successfully in 1.25 and 1.58 seconds, respectively, and were removed with their anonymous volumes.
- A separate anonymous read confirmed that **`0.1.0` still points to its original digest**, recorded below. Its image was not replaced.

### Bounded preview opening

Four focused scenarios passed in Chromium and Firefox (5.2 seconds, no OTP or production account writes). A stalled API and a silent frame both reach the error state within the single 25-second opening deadline. Frame reloads cannot extend it; retry recovers; late responses and reloads after a successful handshake do not trigger a false timeout. English and French messages and the original-site link were verified.

The standard production Docker image compiled successfully with this correction. The published 0.1.1 image includes that source revision; the original 0.1.0 image predates it. These four UI checks and the two-architecture startup checks are separate validations; the full earlier integration suite is recorded in its own sections below.

### Production checks recorded on 15 September

A production email-send test was accepted by the configured SMTP service; **receipt in the destination inbox has not been confirmed**. At the time of this record, **wildcard TLS for the selected `*.repere.dev` preview route was not configured**. Local HTTPS isolation tests use a test certificate and do not establish public DNS, certificate issuance, renewal or successful production preview access.

## Docker Hub 0.1.0 — 15 September 2026

Version **`0.1.0` was published** to [Docker Hub](https://hub.docker.com/r/synapsr/repere) from the frozen source revision [`ef36f020b83851bc1430e83f901c7286e0cae7df`](https://github.com/Synapsr/Repere/commit/ef36f020b83851bc1430e83f901c7286e0cae7df). Changes made to `main` after that revision are not part of this image.

At the first publication, tags **`0.1.0`**, **`0.1`** and **`latest`** returned this public multi-platform index. The immutable `0.1.0` tag still retains it; `0.1` now identifies 0.1.1 and `latest` follows the newest release:

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

That older image exposed the faulty gateway healthcheck. The fix was exercised against both integrated and external database containers, then included in the published 0.1.0 image whose two-architecture startup checks are recorded in this historical section. The persistence round trip and the final image smoke checks are separate pieces of evidence.

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
