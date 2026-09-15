# Changelog

This file records user-visible changes. Container version `0.1.0` is available on [Docker Hub](https://hub.docker.com/r/synapsr/repere).

## Unreleased — 0.1.1

### Fixed

- Website opening now has a single 25-second deadline covering the API request and preview loading. A blocked connection displays a localized retry action and a link to the original website. Frame reloads no longer postpone the deadline or trigger a timeout after a successful load.

## 0.1.0 — 2026-09-15

The published image was built from [`ef36f020`](https://github.com/Synapsr/Repere/commit/ef36f020b83851bc1430e83f901c7286e0cae7df). Tags `0.1.0`, `0.1` and `latest` identify the same AMD64/ARM64 index:

```text
sha256:860000ef8c3ce45f40aff05aacf33935eec7fc4bf4cae1fb83152e83558221fa
```

### Added

- Website and private PDF projects with shared review links.
- Email one-time-code sign-in, named feedback and persistent conversations.
- Native website navigation through isolated preview origins, with page-specific DOM anchors.
- PDF rendering, page-specific points, zoom and bundled scanned-document decoders.
- Replies, resolution, reopening, filters, project archives and sharing-link rotation.
- English and French UI, browser-language negotiation and a persistent language preference.
- A compact review toolbar and project options menu.
- Automatic sign-in when a complete email code is pasted.
- A comment cursor with a plus before placement and a plain bubble after placement.
- A short, replayable first-visit guide for invited website reviewers, with reduced-motion support.
- Docker Compose setup with MySQL, migrations, persistent uploads and a local Mailpit inbox.
- Single-container packaging with integrated MySQL by default or an external MySQL connection.
- Automatic database readiness checks and migrations in the standard application Docker image.
- A two-service EasyPanel deployment guide for the application and isolated previews.
- Host-prefixed HTTPS session cookies and real-browser sibling-origin isolation tests.
- Unit, HTTP transport and real database/email/browser integration tests.
- English documentation, a French README, contribution templates and deployment guidance.

### Known scope

- Website compatibility depends on the original site's origin, cookie and integration assumptions. See [the preview guide](docs/PREVIEW.md#compatibility).
- Preview sessions are in memory on one service instance; restarting it requires reopening previews.
- Audio feedback, Whisper transcription, text replacement suggestions, organizations, exports and account deletion remain on the [roadmap](README.md#roadmap).

Test results belong in the dated [verification record](docs/VERIFICATION.md), not in release promises.
