# API and shared contracts

JSON errors contain a readable localized `error` string and a stable `code`, with the appropriate HTTP status. Mutation requests require `Origin` matching `APP_URL`. JSON bodies are strictly validated. Identifiers and tokens never bypass server-side permissions.

| Method / route                                    | Request                                                                                     | Result / access                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/auth/me`                                | —                                                                                           | `{user: User \| null}`                                   |
| `POST /api/auth/request`                          | `{email,name?}`                                                                             | `{ok:true}`, OTP delivered by SMTP                       |
| `POST /api/auth/verify`                           | `{email,code}`                                                                              | `{user}`, HTTP-only session cookie                       |
| `POST /api/auth/logout`                           | —                                                                                           | `{ok:true}`, session revoked                             |
| `POST /api/locale`                                | `{locale: "en" \| "fr"}`                                                                    | `{locale}`, persistent language-preference cookie        |
| `GET /api/projects`                               | —                                                                                           | `{projects: Project[]}`, owner only                      |
| `POST /api/projects`                              | JSON `{name,description?,type:"website",url}` or multipart `name,description,type=pdf,file` | `{project}`, authenticated                               |
| `PATCH /api/projects/[id]`                        | `{name?,description?,archived?,rotateShareToken?}`                                          | `{project}`, owner only                                  |
| `GET /api/reviews/[token]`                        | —                                                                                           | `ReviewData`, metadata with link; contents after sign-in |
| `GET /api/reviews/[token]/file`                   | —                                                                                           | Private PDF, authenticated and valid link                |
| `POST /api/reviews/[token]/comments`              | `{body,anchor}`                                                                             | `{comment: Feedback}`                                    |
| `PATCH /api/reviews/[token]/comments/[id]`        | `{status}`                                                                                  | `{comment}`, author or owner                             |
| `POST /api/reviews/[token]/comments/[id]/replies` | `{body}`                                                                                    | `{reply}`                                                |
| `POST /api/reviews/[token]/preview`               | —                                                                                           | `PreviewSession`, authenticated active website project   |
| `GET /api/health`                                 | —                                                                                           | `{ok:true}`, 503 when MySQL is unavailable               |

## Anchors

Business types live in [`shared/types.ts`](../shared/types.ts).

- `WebsiteAnchor.x/y` are 0–1 fractions inside the element. `documentX/Y` are fallback document coordinates in CSS pixels; `viewportWidth/Height` record the viewport when the point was placed. The original URL retains its path, query and fragment and must match the project's origin.
- `PdfAnchor.x/y` are 0–1 fractions inside a PDF page. Pages are numbered from one.

The API currently accepts text comments. Reserved schema fields for audio and text suggestions do not make those features available to clients.

## Preview messages

[`PreviewSession`](../shared/preview.ts) contains `{url,origin,targetUrl,channel,expiresAt}`. The injected `PreviewConfig` carries the initial optional locale. Parent commands are `init`, `locale`, `mode`, `pins`, `focus`, `draft`, `navigate`, `back`, `forward` and `reload`; bridge events are `ready`, `location`, `anchor`, `select` and `error`.

Messages are bound to a window source, exact origin and channel. Website payloads are validated before they become a draft and revalidated by the API on explicit publication. Use the shared protocol types rather than recreating partial message shapes.

The proxy has a separate control API: `POST /__repere/sessions`, authenticated with `Authorization: Bearer PROXY_SECRET`. The iframe never calls it. See [PREVIEW.md](PREVIEW.md) for transport and [BACKEND.md](BACKEND.md) for quotas and permissions.

## Locale

A valid `repere_locale` cookie takes precedence over `Accept-Language`; unsupported preferences fall back to English. Regional language tags map to supported English/French catalogs. Locale changes do not change routes or review links. Treat error codes as identifiers and translated messages as display text.
