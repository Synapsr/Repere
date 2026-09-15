# Contributing to Repère

Repère aims to make precise website and PDF feedback easy to use, install and maintain. Contributions that keep that workflow clear are welcome.

## Get started

Follow the [local quick start](README.md#quick-start). Use Node.js 24 (`nvm use`), npm and Docker. Commit `package-lock.json` when dependencies change; it is the source of truth for installed versions.

Run `npm ci` to install host development tools. For hot reloading on your machine, see [development and testing](docs/TESTING.md#fast-local-development). Keep `.env`, uploaded documents, authentication data and browser traces out of commits.

## Make a focused change

1. Describe the user problem before a substantial feature or architecture change. If this copy is published on a forge, use its issue tracker; do not assume discussions or other services are enabled.
2. Work on a branch and keep the change focused. Documentation fixes and small bug fixes can go straight to a pull request.
3. Keep strict TypeScript, understandable error messages, input limits and server-side permission checks.
4. For schema changes, run `npm run db:generate`, review the generated SQL and include the migration. Use versioned migrations for deployment, not `drizzle-kit push`.
5. For protocol changes, update both ends and the contracts in `shared/types.ts`, `shared/preview.ts` and [docs/CONTRACT.md](docs/CONTRACT.md).
6. Test the behavior or security boundary that changed. Prefer meaningful regressions over tests that duplicate implementation details.

## Languages and copy

English is the primary README; keep [README.fr.md](README.fr.md) aligned when features or installation steps change. Technical documentation is in English.

The application uses next-intl with English and French catalogs. Add equivalent keys to both languages and use the translation helpers instead of embedding UI strings in components. Keep user-generated names and comments unchanged. Dates, counts and email copy should use the selected locale.

Locale selection uses a saved preference, then the browser's language header, then English. It does not alter project URLs. A language change must preserve an unsent comment, the current page and the active review session. Include a regression when changing that behavior.

## Design and security principles

- Browsing is the initial mode; placing a point is an explicit action.
- Important controls have visible labels or accessible names. Keep keyboard and narrow-screen use practical.
- The server validates all input and derives permissions from the authenticated user and current project state.
- Site JavaScript remains untrusted. Keep the application and previews isolated; do not send application secrets to the annotation bridge.
- Do not rewrite website JavaScript files or widen network access to make a failing compatibility test pass.
- Keep secrets, OTP codes, sharing tokens and user content out of logs.
- Describe planned work as planned, and observed compatibility as evidence for those tested cases.

## Verify your work

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
```

Run the relevant [integration tests](docs/TESTING.md) against a development MySQL database and Mailpit. For review, auth, upload or preview changes, use the browser tests in Chromium and Firefox. Tests create real disposable projects; avoid a production database. Do not weaken OTP throttles to make repeated runs pass.

For visual changes, include desktop and narrow-screen screenshots. For preview changes, name the fixture or public URL, browser, navigation and interactions you actually checked. Do not submit private website content, tokens or customer documents as fixtures.

## Pull requests

Explain the concrete problem, the resulting behavior and the checks performed. Call out migrations, configuration changes and compatibility limits a reviewer needs to know. Mark any check you did not run with its reason. A repository template is provided in [.github/pull_request_template.md](.github/pull_request_template.md).

Keep dependency changes deliberate. Do not add an integration requiring credentials without documenting its configuration and failure behavior.

### Tooling compatibility

ESLint 9 is pinned while the stable React, Import and JSX Accessibility plugins used by `eslint-config-next` declare support only through ESLint 9. [ESLint 9 is out of maintenance](https://eslint.org/version-support/); move to ESLint 10 when those upstream plugins support it, and rerun the full lint checks. Do not bypass peer dependency checks to hide an incompatible upgrade. The targeted `@esbuild-kit/core-utils` override uses the project's current esbuild to replace an affected transitive development dependency; Drizzle generation and snapshot checks were verified with this override.

## Licensing and conduct

By contributing, you agree that your contribution can be distributed under the project's MIT license. Submit only code, assets and data that you have the right to redistribute. Preserve upstream license notices; update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when distributed dependencies or assets change.

Treat contributors respectfully, explain disagreements with concrete examples, and keep feedback about the work. Report security issues through [SECURITY.md](SECURITY.md), not a public reproduction.
