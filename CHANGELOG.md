# Changelog

This file records user-visible changes. The repository has not yet published a tagged release or container image.

## Unreleased — 0.1.0 preparation

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
