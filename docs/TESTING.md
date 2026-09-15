# Testing Repère

Tests exercise real MySQL persistence, SMTP delivery through Mailpit, HTTP-only sessions and native website previews. They create unique identities and projects; they do not bypass OTP, mock API responses, seed production content or delete existing projects. Use a development database because test projects remain available for inspection.

## Complete local stack

Requirements: Node.js 22.13+ (Node.js 24 recommended), npm and Docker with Compose v2.

```sh
npm ci
npm run setup
npx playwright install chromium firefox
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

`setup` creates `.env` with independent cryptographic secrets and available local ports. It preserves existing values and adds missing native preview configuration when upgrading. MySQL data, PDF uploads and the local mailbox persist in named Docker volumes. Database migrations must complete before the app starts.

The generated configuration uses app port 3000, preview proxy port 3001, MySQL port 3308, inbox port 8026 and SMTP port 1026 when available. Read `.env` for the actual addresses. Each website review runs in an iframe at a unique `<random>.localhost:3001` origin. Chromium and Firefox resolve localhost subdomains locally. No browser executable is installed or launched by the production application or preview proxy; Playwright browsers are used by the test suite only.

Mailpit belongs only to `compose.dev.yaml`. Configure your real SMTP service with the production `compose.yaml`. Public deployments require a separate wildcard preview domain with HTTPS; use a different registrable domain from the application to isolate site cookies and scripts.

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
- API integration covers SMTP OTP delivery, wrong and reused codes, concurrent verification, attempt lockout, session revocation, CSRF, shared-link authentication, owner permissions, named reviewers, replies, resolution, token rotation, archive behavior, concurrent numbering and counters, PDF delivery and invalid input.
- Native preview API checks cover per-session origins, canonical target URLs and rejection of metadata/private destinations.
- UI tests execute the website's own DOM directly in Chromium and Firefox: links, React hydration, counter, form submission, tabs/history, precise anchors, sharing, replies and status changes. They inspect actual requests for application-cookie isolation, verify blocked parent DOM access, and test JavaScript and HTTP-only site cookies across independent reviewers.
- Native iframe tests reject forged malformed or unrelated-page messages, restore numbered points after a same-page reload, and check a 390-pixel mobile viewport.
- PDF UI tests cover two-page rendering, page-specific points, zoom and persistence after reload. An original CCITT scanned PDF fixture checks that the decoder loads successfully and the canvas contains the expected black and white pixels. Archive regressions check that owners can still read feedback and PDFs, while archived websites do not start new preview sessions.
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
