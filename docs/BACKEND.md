# Backend and access controls

## Components and migrations

Next.js Route Handlers call services in `src/lib/server/`. Drizzle uses a lazily opened `mysql2` pool with UTC dates. Building the application does not require a live database or production secrets.

The schema is in `src/db/schema.ts` and versioned SQL migrations are in `drizzle/`. Generate changes with `npm run db:generate`, review the SQL, then apply with `npm run db:migrate`. The migration container completes before the app starts. Do not use `drizzle-kit push` for production deployments. MySQL DDL is not always transactional: back up before schema changes.

## Email identity

- Six-digit codes generated with `crypto.randomInt`, valid for ten minutes, with at most five attempts and one successful use.
- The database stores an HMAC SHA-256 tied to the email and `SESSION_SECRET`. Codes are neither returned by the API nor logged. Local email goes to Mailpit.
- One challenge per email. Resending invalidates the previous code. Verification locks the row with `SELECT … FOR UPDATE`, so concurrent requests cannot both consume a code. Failed attempts are committed before an error is returned.
- Random 256-bit sessions; only their SHA-256 hashes are stored. Sessions last a fixed 30 days. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `APP_URL` is HTTPS. Logout removes the server-side session.
- The name at first sign-in creates the profile. Signing in again does not rename an existing account.

`SESSION_SECRET` and `PROXY_SECRET` require at least 32 characters. Generate independent values, for example with `openssl rand -hex 32`; setup does this automatically. Changing `SESSION_SECRET` invalidates active OTPs and changes rate-limit keys, but does not revoke existing sessions. Global session revocation requires removing their database rows deliberately.

## Languages

English and French use shared project URLs, without a locale path prefix. Locale precedence is a valid `repere_locale` cookie, then `Accept-Language` quality/regional matching, then English.

`POST /api/locale` accepts `{locale: "en" | "fr"}` and requires the same origin checks as other mutations. The preference cookie is host-only, `HttpOnly`, `SameSite=Lax`, lasts one year and is `Secure` under HTTPS. It is a preference, not an authentication credential.

API errors retain a readable `error` string and provide a stable `code`. The error text and OTP email use the request's resolved language; clients should branch on the code rather than matching translated prose. User-generated content is not translated.

## Workspaces and project access

Every project belongs to a workspace. `workspace_members` joins users to spaces with an `owner` or `member` role. Both roles can manage that space’s projects and resolve feedback. `projects.createdBy` is nullable audit information, never an authorization grant. Holding a review link does not grant workspace membership.

The dashboard lists only the selected workspace’s projects. Its URL carries `?workspace=<id>`; the browser remembers the last space separately for each signed-in user. Every API request checks membership again. Moving a project requires membership in both source and destination; its ID, sharing token, comments and PDF storage stay intact.

`GET /api/workspaces` creates a first space for an account with no memberships, serializing on its user row to avoid duplicates. Explicit workspace and project creation respect `ALLOWED_EMAIL_DOMAINS=agency.example,example.com`. Reviewers can still verify their email and participate through shared links. Workspace invitations do not grant workspace-creation privileges or bypass this domain restriction.

### Inviting a team

The workspace menu opens **Members**. Owners can invite an email address, resend or cancel a pending invitation, and remove a member. All members can read the roster and manage workspace projects. Only owners can administer membership; the API does not accept a role supplied by a client. Owners cannot remove themselves or another owner.

An invitation lasts seven days and requires explicit acceptance by a signed-in account with the exact invited, normalized email address. The existing email-code login verifies that identity. Opening a link alone never grants access. The public invitation page shows a masked address; the API never returns the secret token. The database stores only SHA-256 hashes of random 256-bit tokens.

Successful resend replaces the previous invitation link. SMTP failures preserve an existing working link, and cancellation prevents an in-flight delivery from reactivating it. Invitation writes and membership changes use transactions and row locks. Project writes recheck membership inside their transaction, including after a PDF upload. Removing a member preserves their projects and comments; an already accepted invitation cannot re-add them. A new invitation and acceptance are required.

**Shared review links remain usable after removal.** Workspace membership controls project administration, while a valid review link separately permits guest participation. Rotate a project's shared link if it must no longer be used by its previous recipients.

### Upgrades and shared reviews

The workspace migration creates one space per existing project owner, copies their membership, and assigns all their projects before enforcing the new foreign key. Existing project and comment IDs, share tokens, files and sessions are unchanged. The original project owner becomes `createdBy`. Back up MySQL and uploads before upgrading; stop the previous app while changing the schema. Reverting application code alone does not revert the migration.

A review link contains a random 256-bit token. Without sign-in, its holder can see project metadata, but not comments or the PDF. After sign-in, they can read feedback and reply. Workspace members and a comment's author may resolve or reopen that comment. Signed-in participants see author names and emails; this model is intended for a link shared with a trusted group.

Rotating a link invalidates API requests using the old link. Archiving closes guest access and gives workspace members a read-only view. A native preview already open may remain available until its session expires, at most one hour; it no longer authorizes comments through an invalid link. Writes recheck token and archive state under a lock.

Comment numbers and counters are assigned in a transaction that locks the project first. A unique `(projectId, number)` constraint prevents duplicate numbering. Repeated resolution is idempotent. Anchor types must match the project; website anchors must retain its exact origin (scheme, host and port), while paths, query strings and fragments may differ.

## Request protection

Every mutation, including OTP and locale changes, requires `Origin` to exactly match `APP_URL`'s origin. `Sec-Fetch-Site: cross-site` is also rejected. API clients must send that `Origin` explicitly; no permissive CORS policy is supplied.

Rate limits live in MySQL, are consumed under locks and survive application restarts. HMAC keys avoid adding plaintext email/IP values to the limit table.

| Action                                                          | Limit                                      |
| --------------------------------------------------------------- | ------------------------------------------ |
| OTP send per email                                              | 3 / 10 minutes                             |
| OTP send per network / whole instance                           | 30 / 10 minutes; 200 / 10 minutes globally |
| OTP verification per email / network                            | 20 / 10 minutes; 100 / 10 minutes          |
| Workspace creation per user                                     | 20 / hour                                  |
| Invitation send per user / workspace / recipient in a workspace | 30 / hour; 50 / hour; 5 / hour             |
| Invitation accept, cancel or member removal per user            | 60 / hour per action                       |
| Project creation per user                                       | 30 / hour                                  |
| Comment or reply per user                                       | 60 / minute per action                     |
| Status changes per user                                         | 120 / minute                               |
| Preview creation per user                                       | 20 / minute                                |

By default, clients share the network limit rather than being allowed to bypass it with forged `X-Forwarded-For`. Enable `TRUST_PROXY=true` only behind a trusted ingress that overwrites this header and prevents direct app access; its first address is then used. Review `rate-limit.ts` and service quotas for your expected load.

## Private PDFs

Uploads are limited to 20 MiB. The raw body is counted before multipart parsing, even without `Content-Length`, with 64 KiB allowed for fields. The extension and `%PDF-` signature are checked. This is type validation, not antivirus scanning or complete document validation. PDF.js parses the document in the client.

UUID filenames live outside `public/` in `UPLOAD_DIR` (fallback `./data/uploads`; setup uses `./uploads`, Compose `/app/uploads`). Directories and files use modes `0700` and `0600`. The app container must be able to write the volume. Failed project creation removes the newly written upload.

Reading requires a valid session and current review link; workspace members retain access after archiving. The response streams bounded chunks, closes the file descriptor on completion/cancellation, and sets private/no-store caching, `nosniff` and a sandbox CSP.

PDF.js worker, decoding binaries, JavaScript fallbacks, CMaps, required fonts and ICC resources are copied from the pinned package during install. Their URLs include the PDF.js version; their upstream notices are distributed alongside them. Keep the viewer and these assets on the same version.

Local storage fits one app instance. Replicas would need shared storage; an S3 interface and permanent project deletion are future work. Back up MySQL and uploads together.

## Website previews

`POST /api/reviews/[token]/preview` requires a user session, an active website project/link and a valid application origin. The backend calls only `PROXY_INTERNAL_URL` with the independent `PROXY_SECRET` and explicit project/user identifiers. It forwards no user request cookies or headers. Responses are capped at 16 KiB, and returned URLs are validated before reaching the client.

The website runs in the user's browser at a unique 48-hex-character subdomain under `PREVIEW_BASE_URL`. That hostname grants temporary proxy access; transporting a public page does not require a third-party authentication cookie. Site cookies remain in the browser, scoped to the preview, and their availability depends on browser policies and HTTPS deployment.

The proxy validates destinations and initial redirects. The backend saves the resulting canonical URL transactionally so anchors use the correct origin. Iframe messages never create comments directly: the app validates an anchor and retains explicit publishing in its interface.

Use different hosts locally, such as `localhost:3000` for the app and `<session>.localhost:3001` for previews. Ports alone do not isolate cookies. In production use HTTPS and wildcard session hostnames distinct from the application hostname. The `__Host-repere_session` cookie cannot be set with a parent Domain; mutations require the exact application Origin. The backend rejects HTTP previews when the app is HTTPS. See [PREVIEW.md](PREVIEW.md).

`DEMO_SITE_URL` is an optional Docker-development mapping from `APP_URL/demo-site` to the internal demo address, preserving path suffix, query and fragment. Leave it unset in production.

## Operations

Configure the database, application URL, independent secrets, preview addresses, SMTP and upload storage. SMTP failure invalidates the challenge and returns 503. `/api/health` returns 503 when MySQL is unavailable; it does not check SMTP or previews.

Expired technical records can be purged periodically through your hosting scheduler, after adapting retention to your needs:

```sql
DELETE FROM sessions WHERE expiresAt < UTC_TIMESTAMP();
DELETE FROM otp_challenges WHERE expiresAt < UTC_TIMESTAMP() - INTERVAL 1 DAY;
DELETE FROM rate_limits WHERE expiresAt < UTC_TIMESTAMP() - INTERVAL 1 DAY;
```

Services do not log SQL parameters, comments, OTP codes or sharing tokens. API responses hide internal errors. Add controlled observability and ingress traffic/upload limits for the deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) for backups and upgrades.

## Future content types

`comments.kind` reserves `audio` and `text-suggestion`; `originalText` and `suggestedText` can store replacement proposals. `attachments` reserves MIME type, size, audio duration, transcription, transcription state and provider. The current API does not create these content types. Existing anchors and fallback coordinates can be reused by those future workflows.

## Comment screenshots

`POST /api/reviews/:token/comments` accepts an optional `capture` object containing a
JPEG `dataUrl`, an ISO `capturedAt`, and `pointX`/`pointY` fractions. Only this JSON route
allows up to 3 MiB; decoded JPEGs are limited to 2 MiB, 4096 pixels per side and 8 million
pixels. The server validates and re-encodes them with Sharp, removing embedded metadata.

The comment and its `comment_screenshots` metadata commit in one MySQL transaction.
Files use random names in the private `UPLOAD_DIR/captures` directory; a failed transaction
removes the prepared file. Cancelled drafts never reach the server. Back up uploads and
MySQL together. Old comments have no screenshot and remain compatible.

`GET /api/reviews/:token/comments/:id/screenshot` requires a signed-in user, a current
review token and a comment in that project. Archived projects remain available to workspace
members only. Responses are private, uncached JPEGs; storage paths are never exposed.

## Feedback prompts

`GET /api/projects/:id/prompt` returns `{ prompt, count }` for all currently open
comments. An optional `commentId` selects a single open comment in that project.
Resolved or empty selections return `PROMPT_EMPTY` (409); missing or unrelated
comments return 404. Responses are uncached and follow the locale cookie/browser
language. Repeated, malformed or unsupported query parameters are rejected.

The endpoint requires current workspace membership, even when a signed-in guest
can read the shared review. Project and membership rows stay shared-locked while
the feedback is read, preserving authorization across project moves and removals.
No comments are changed, no AI provider is called, and no account email fields,
share tokens, file-storage keys or image bytes are added to the prompt. The text
of feedback and replies is preserved, including any details their authors wrote.
