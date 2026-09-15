# Verification record

This page records observed checks, not compatibility promises. Test instructions are in [TESTING.md](TESTING.md).

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

These checks do not cover every website or PDF. Production wildcard domains, certificates, external SMTP and deployment-specific cookie behavior must be verified on the actual host. OAuth, third-party CORS and scripts tied to their original domain may require compatibility work.

Public-site timings are individual observations, not a benchmark or performance guarantee. No hosted CI run, published image or public deployment is implied by this local record.
