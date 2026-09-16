# Testing Repère

Tests exercise real MySQL persistence, SMTP delivery through Mailpit, HTTP-only sessions and native website previews. They create unique identities and projects; the complete user journeys do not bypass OTP, seed production content or delete existing projects. Focused onboarding and connection-failure regressions use controlled responses. Use a development database because test projects remain available for inspection.

## Complete local stack

Requirements: Node.js 22.13+ (Node.js 24 recommended), npm and Docker with Compose v2.

```sh
npm ci
npm run setup
npx playwright install chromium firefox
npm run lint
npm run typecheck
npm test
npm run test:migrations
npm run test:invitations
npm run test:integration
# Run the browser suite on a separate disposable stack, or after the OTP window expires.
npm run test:ui
```

`setup` creates `.env` with independent cryptographic secrets and available local ports. It preserves existing values and adds missing native preview configuration when upgrading. MySQL data, PDF uploads and the local mailbox persist in named Docker volumes. Database migrations must complete before the app starts.

The generated configuration uses app port 3000, preview proxy port 3001, MySQL port 3308, inbox port 8026 and SMTP port 1026 when available. Read `.env` for the actual addresses. Each website review runs in an iframe at a unique `<random>.localhost:3001` origin. Chromium and Firefox resolve localhost subdomains locally. No browser executable is installed or launched by the production application or preview proxy; Playwright browsers are used by the test suite only.

Mailpit belongs only to `compose.dev.yaml`. Configure your real SMTP service with the production `compose.yaml`. Public deployments require HTTPS and wildcard preview hostnames distinct from the application hostname. The application uses a protected `__Host-` session cookie on HTTPS and enforces exact-Origin mutation checks.

```sh
# API integration only: no local browser download required.
npm run test:integration

# Native DOM flows in Chromium and Firefox.
npm run test:ui

# Browse failure screenshots, DOM snapshots, requests and action timelines.
npx playwright show-report
```

Playwright reads `.env`. You can override `E2E_BASE_URL`, `MAILPIT_URL` or `E2E_WEBSITE_URL` in your shell. The complete Docker fixture URL is `http://app:3000/demo-site`; the proxy accesses it on the Compose network. It is intentionally the only private host allowed by the development overlay. Production rejects private network targets by default.

## Fast local development

```sh
node scripts/setup.mjs --env-only
docker compose -f compose.yaml -f compose.dev.yaml up -d db mailpit
npm run db:migrate
npm run dev
# In a second terminal:
npm run build:preview
npm run preview:dev
```

The local app uses `PROXY_INTERNAL_URL=http://127.0.0.1:3001`. For tests against a proxy running on your machine, set `E2E_WEBSITE_URL=http://localhost:3000/demo-site` (adapt the app port if needed) and keep `PREVIEW_ALLOWED_PRIVATE_HOSTS=localhost,127.0.0.1` only in this local environment. Run either the Docker services or host processes on a given port.

## Coverage and limits

- Unit and transport tests cover validation, session boundaries, URL rewriting and actual HTTP proxy behavior with local fixtures.
- API integration covers SMTP OTP delivery, wrong and reused codes, concurrent verification, attempt lockout, session revocation, CSRF, shared-link authentication, workspace permissions, named reviewers, replies, resolution, token rotation, archive behavior, concurrent numbering and counters, PDF delivery and invalid input.
- Native preview API checks cover per-session origins, canonical target URLs and rejection of metadata/private destinations.
- UI tests execute the website's own DOM directly in Chromium and Firefox: links, React hydration, counter, form submission, tabs/history, precise anchors, sharing, replies and status changes. They inspect actual requests for application-cookie isolation, verify blocked parent DOM access, and test JavaScript and HTTP-only site cookies across independent reviewers.
- Native iframe tests reject forged malformed or unrelated-page messages, restore numbered points after a same-page reload, and check a 390-pixel mobile viewport.
- PDF UI tests cover two-page rendering, page-specific points, zoom and persistence after reload. An original CCITT scanned PDF fixture checks that the decoder loads successfully and the canvas contains the expected black and white pixels. Archive regressions check that workspace members can still read feedback and PDFs, while archived websites do not start new preview sessions.
- Locale checks cover English UI, French browser negotiation, a persistent language choice, translated OTP emails and stable API error codes. Switching a review to English must preserve the current page, preview session and unsent comment.

The established browser flows use an explicit `fr-FR` locale; the language test also opens an independent `en-US` context. Screenshots and traces go only to `test-results/` and `playwright-report/`, which are ignored by Git. Test runs do not overwrite the curated README images in `docs/images/`.

The local interactive fixture validates Next.js and browser behavior. It cannot prove compatibility with every external website. Third-party CORS restrictions, anti-bot systems, unusual authentication flows and scripts tied to their original hostname can require additional compatibility work. Test representative real staging URLs before relying on them for client reviews.

Do not repeatedly run the suite against production: real OTP throttles remain enabled. Repeated runs in a shared ten-minute window can reach the limits. Wait for the window or use an isolated test database; do not disable the protections to pass tests.

## Inspect and stop

```sh
docker compose -f compose.yaml -f compose.dev.yaml ps
docker compose -f compose.yaml -f compose.dev.yaml logs --tail=100 app preview migrate
# Stops containers and preserves data.
docker compose -f compose.yaml -f compose.dev.yaml down
```

Remove volumes only when deliberately resetting a disposable test installation. CI creates a fresh Docker environment and removes its own test volumes on completion.

## Workspace migrations

`npm run test:migrations` starts its own MySQL 8.4 container with a random password and loopback-only port. It does not read `.env` or `DATABASE_URL`. It seeds the 0.1.1 schema with two project owners, an invited reviewer, website feedback, replies, attachment metadata, an archived PDF and a session, then applies the current Drizzle migrations. Assertions compare retained records and links, check workspace membership, resume an interrupted backfill, repeat migrations, and verify a fresh installation. The command removes only its own disposable container and volumes when finished.

Workspace API tests verify membership-based management, project isolation, transfers and guest sharing. Their member fixture connects only to the development MySQL database; this fixture does not bypass the separate invitation scenarios, which use the public API and real emails. Browser tests cover creation, switching, navigation history, remembered selection, keyboard and narrow-screen use.

## Workspace invitation checks

Invitation integration tests send only to synthetic `example.test` addresses captured by local Mailpit. They exercise email delivery, the existing OTP sign-in, explicit acceptance, matching-email enforcement, resend/cancel/expiry, owner-only administration, and removal without restoring access through an old accepted link. Browser checks cover the members dialog and invitation journey in Chromium and Firefox, including narrow-screen and keyboard use.

CI runs lint, types, unit tests and migrations first, then API and browser integration jobs on **independent MySQL and Mailpit installations**. Each job stays within the normal OTP network quota. To run both groups locally against one installation, allow the ten-minute OTP window to expire between them; alternatively use separate Compose project names, ports and volumes. `npm run test:e2e` still selects every project and may exceed the network quota on a single installation. Keep the production limits enabled.

The migration test also stops at the released 0.2.0 schema, adds a workspace member, and verifies that the invitation upgrade preserves all workspaces, memberships and existing records. It simulates interruption after the invitation table is created and confirms that rerunning the migration retains an existing invitation.

`npm run test:invitations` creates another disposable MySQL container and stubs only email delivery. It verifies that a first send failure exposes no usable link, a resend failure preserves the old delivered link, cancellation during SMTP cannot be undone, and acceptance followed by removal prevents a pending resend from restoring access. It reads neither `.env` nor the configured application database and removes only its own container.

## Comment screenshots

Screenshot API tests validate real JPEG decoding, immutable stored pixels, private access,
review-link rotation, archived guest access, rejected malformed/oversized images and
unchanged comment counters after rejected uploads. They use synthetic local accounts.

Chromium and Firefox tests place a point on a green element, change it to red before
publishing, and inspect the stored JPEG pixels to prove the original state was retained.
They check cancelled drafts, scrolling, navigation interactions, reload, marker placement
and the icon-triggered expanded view. Drafts contain no image or capture status; publishing waits for capture completion. A two-page PDF with distinct page colors proves that the current
rendered page is captured. Capture helper tests cover immediate cloning, timeouts and
abandoned work. These fixtures do not establish pixel-perfect support for all external
websites, cross-origin media or CSS effects.
