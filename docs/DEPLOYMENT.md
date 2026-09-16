# Deployment

[Back to the README](../README.md)

Choose the deployment mode that matches your infrastructure:

- **EasyPanel with existing MySQL:** [two-service setup](EASYPANEL.md), application on port 3000 and native preview on port 3001.
- **Single Docker image:** [image guide](DOCKER.md), one gateway on port 8080, persistent `/data`, integrated or external MySQL.
- **Separate-service Compose:** follow the guide below.

This guide covers the advanced **separate-service Compose stack**. Its local overlay uses Mailpit; a public instance needs real SMTP and isolated HTTPS preview origins.

## Local setup

```sh
node scripts/setup.mjs
```

This uses both `compose.yaml` and `compose.dev.yaml`. Setup generates independent secrets and available ports in a private `.env`, builds the services and waits for health checks. MySQL migrations must finish before the app starts. Existing configuration and named volumes are preserved.

See the [quick start](../README.md#quick-start) for the first review and [TESTING.md](TESTING.md) for host development.

## Production domains and email

Use **`compose.yaml` only** in production. The development overlay adds Mailpit, published database ports and the private demo-host exception.

1. Prepare a local checkout with Docker Compose and Node.js:

   ```sh
   node scripts/setup.mjs --env-only
   ```

2. Edit `.env` for your actual domains and SMTP service. The following values are examples, not working credentials:

   ```dotenv
   APP_URL=https://app.repere.dev
   PREVIEW_BASE_URL=https://repere.dev
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-smtp-user
   SMTP_PASSWORD=your-smtp-password
   SMTP_FROM=Repere <hello@example.com>
   SMTP_SECURE=false
   ALLOWED_EMAIL_DOMAINS=your-agency.example
   ```

3. Replace these example domains with your own. Point `app.repere.dev` and `*.repere.dev` to the ingress and provision HTTPS, including a wildcard certificate for preview sessions. Each preview has a random 48-character subdomain and a distinct origin; HTTPS app sessions use a host-prefixed cookie. A different registrable domain for previews is also supported. The apex `repere.dev` may point to a separate website: it is not itself a preview session.
4. Put a TLS reverse proxy in front of the local application and preview ports, normally 3000 and 3001: route the exact app hostname to 3000 and preview session hostnames to 3001. Give exact application and apex website routes higher priority than any wildcard preview route, so `app.repere.dev` cannot be captured by `*.repere.dev`. Preserve the preview's `Host`, WebSocket upgrades and streaming responses. Adapt the supplied [Nginx example](nginx.conf), including certificate paths and any generated port changes. Keep the preview control endpoint private.
5. Start the stack:

   ```sh
   docker compose -f compose.yaml build
   ```

docker compose -f compose.yaml stop app
docker compose -f compose.yaml up -d --wait

````

6. From the real HTTPS domains, verify email-code delivery, an authenticated review, site cookies and representative PDF documents. DNS, TLS and external SMTP are deployment-specific checks; the local suite does not cover them.

Compose binds app and preview ports to `127.0.0.1`. The sample assumes the TLS proxy runs on the host. If your ingress runs in a container, connect it to the appropriate Docker network and adapt its upstreams deliberately.

`SMTP_SECURE=true` enables implicit TLS, commonly on port 465. Port 587 normally uses STARTTLS with `SMTP_SECURE=false`. Configure delivery records and sender verification with your email provider. Without working SMTP, users cannot complete sign-in.

`ALLOWED_EMAIL_DOMAINS` restricts who may create projects; reviewers with a shared link may use other email domains. Leave it empty only when any verified email should be able to create projects.

## Configuration reference

The complete example is [`.env.example`](../.env.example). Compose supplies internal database and preview addresses for its services.

| Setting                                 | Purpose                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `APP_URL`                               | Exact public application origin, also used for CSRF checks and secure cookies     |
| `PREVIEW_BASE_URL`                      | Public parent domain for unique preview subdomains                                |
| `SESSION_SECRET`                        | Independent random secret for OTP and rate-limit hashing                          |
| `PROXY_SECRET`                          | Independent random secret protecting the preview control API                      |
| `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | Distinct database credentials; setup generates hex values safe in the Compose URL |
| `DATABASE_URL`                          | Host-development database URL; Compose sets its own internal URL                  |
| `PROXY_INTERNAL_URL`                    | Host-development preview address; Compose uses `http://preview:3001`              |
| `SMTP_*`                                | Host, port, credentials, sender and TLS mode for email delivery                   |
| `UPLOAD_DIR`                            | Private PDF and screenshot directory; Compose sets `/app/uploads` and persists it           |
| `ALLOWED_EMAIL_DOMAINS`                 | Optional exact domains allowed to create projects                                 |
| `TRUST_PROXY`                           | Use the overwritten client-IP header only behind a trusted ingress                |
| `PREVIEW_MAX_SESSIONS`                  | Concurrent in-memory preview capacity, default 100                                |
| `PREVIEW_SESSION_TTL_MS`                | Preview lifetime, default and maximum one hour                                    |
| `PREVIEW_MAX_HTML_BYTES`                | Maximum decompressed HTML, default 8 MiB                                          |

Keep `PREVIEW_ALLOWED_PRIVATE_HOSTS` and `DEMO_SITE_URL` out of production. Compose's base file does not expose the local demo exception. Never substitute a public wildcard network exception for a compatibility fix.

Leave `TRUST_PROXY=false` unless your ingress overwrites `X-Forwarded-For` and clients cannot reach the application directly. The Nginx example overwrites it. See [backend rate limits](BACKEND.md#request-protection) before adjusting limits for your expected traffic.

## Data and backups

Persist and back up these together:

- **MySQL:** projects, identities, sessions, comments, replies and migration history.
- **The uploads volume:** private PDF files and comment screenshots (`captures/`) referenced by the database.
- **Configuration:** keep `.env` or equivalent secrets encrypted and access-controlled.

Use a database-aware backup, coordinate it with uploaded files, and test a restore into an isolated installation. Do not treat a copy of a running MySQL data directory as a verified backup. A consistent maintenance window is the simplest way to capture database and file state together.

Preview sessions are temporary in-memory state and are not backed up. Restarting the preview service closes those sessions; users reopen their review. Comments, screenshots and PDF uploads remain persistent.

## Updates and maintenance

Back up first, obtain the intended source revision, review its migrations and changelog, then rebuild:

```sh
docker compose -f compose.yaml build
docker compose -f compose.yaml stop app
docker compose -f compose.yaml up -d --wait
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail=100 app preview migrate
````

The 0.2.0 workspace upgrade needs no new environment variables. It preserves existing projects and sharing links, creates a first workspace for each former project owner, and replaces user ownership with workspace membership. On EasyPanel keep **zero-downtime deployment disabled** for this schema upgrade so the previous app cannot write during migration.

MySQL DDL migrations are not universally transactional. Do not assume an application image rollback also reverses a schema change. Keep the prior source revision and a tested restore plan.

Stopping the production stack preserves named volumes:

```sh
docker compose -f compose.yaml down
```

`down --volumes` deletes persisted data; use it only when intentionally resetting a disposable installation. Expired authentication and rate-limit records can be purged according to the [backend maintenance notes](BACKEND.md#operations).

## Capacity and health

The current preview service runs as one instance with in-memory sessions. Local PDF storage also assumes one app instance unless replicas share the storage. S3 support and distributed previews are roadmap work, not deployment flags.

`GET /api/health` checks database access. The preview service has its own `/health` endpoint on the base/internal host. Neither proves email delivery or compatibility with a particular website. Monitor SMTP failures, storage usage, database health and proxy traffic for your environment.

Review [SECURITY.md](../SECURITY.md) and the [compatibility boundaries](PREVIEW.md#compatibility) before opening an instance to clients.

### Workspace invitation upgrade (0.3.0)

The invitation release adds one MySQL table and uses the existing SMTP configuration. No new environment variables or preview-service changes are required. Back up the database before upgrading and let the standard startup migrator finish. Existing spaces, members, projects and sharing links are preserved. Invitations sent by the app require the recipient to sign in with the invited email and accept before joining.
