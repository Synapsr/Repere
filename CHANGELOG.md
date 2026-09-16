# Changelog

This file records user-visible changes. Container version `0.2.0` is available on [Docker Hub](https://hub.docker.com/r/synapsr/repere).

## 0.2.0 — 2026-09-16

Published from [`7bf4877`](https://github.com/Synapsr/Repere/commit/7bf48770902cbb99e678e097105dc74413b7b32f). Tags `0.2.0`, `0.2` and `latest` identify this AMD64/ARM64 index:

```text
sha256:84650557d9c9322500bc47e48dd0c3e4cd5828468535953e1cec22d22f3f333c
```

**Upgrade:** back up MySQL and uploads, then stop the previous app before applying migrations. No new environment variables are required. Project clients now use `workspaceId` and `canManage` instead of `ownerId` and `isOwner`.

### Added

- Workspaces with a compact switcher, creation dialog and remembered selection.
- Projects belong to workspaces; existing projects migrate into their previous owner’s first space with their links, PDFs, comments and sessions preserved.
- Move a project between accessible workspaces from project settings without changing its review link.
- Workspace membership governs project management; guests retain access through shared review links. Team invitations and member administration are future work.

## 0.1.1 — 2026-09-15

The published image was built from [`8e15dded`](https://github.com/Synapsr/Repere/commit/8e15dded1c922333839022e27c1838e3154a261f). Tags `0.1.1` and `0.1` retain this AMD64/ARM64 index; `latest` now points to 0.2.0:

```text
sha256:4701bf47e44a7ec46bc4d0e54940f9d9a51b26f9297193a9eb341740900f8e42
```

### Fixed

- Website opening now has a single 25-second deadline covering the API request and preview loading. A blocked connection displays a localized retry action and a link to the original website. Frame reloads no longer postpone the deadline or trigger a timeout after a successful load.

## 0.1.0 — 2026-09-15

The published image was built from [`ef36f020`](https://github.com/Synapsr/Repere/commit/ef36f020b83851bc1430e83f901c7286e0cae7df). The immutable `0.1.0` tag retains this AMD64/ARM64 index; the `0.1` alias now points to 0.1.1 and `latest` to 0.2.0:

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
