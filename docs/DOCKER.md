# Docker and EasyPanel

[README](../README.md) · [Français](#français) · [Advanced Compose deployment](DEPLOYMENT.md)

The `synapsr/repere` image contains Next.js, the native website preview service and MySQL 8.4. One gateway exposes port **8080**. The application, preview control API and integrated database listen only inside the container.

**[Version 0.3.0 is published on Docker Hub](https://hub.docker.com/r/synapsr/repere)** for `linux/amd64` and `linux/arm64`. Both variants passed startup with integrated MySQL, migrations and health checks, and their public manifests were verified anonymously. The image comes from source revision [`f655468`](https://github.com/Synapsr/Repere/commit/f655468e73e61b6049345f97a91e1d3f54e1868b). See the [verification record](VERIFICATION.md#workspace-invitations-030--16-september-2026) for the scope of these checks.

Published index digest:

```text
synapsr/repere@sha256:073725dcd8d0e65003c11b3745604b2b3eb6f9d17f63c0c551200525606bc51c
```

The tags `0.3.0`, `0.3` and `latest` currently point to this same index. Pin `0.3.0` or the digest for deployment; `latest` and `0.3` may advance with later releases.

## Start with Docker

Create a private `.env.docker` file. Replace the example SMTP settings with your provider's configuration:

```dotenv
APP_URL=http://localhost:8080
PREVIEW_BASE_URL=http://localhost:8080
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=replace-me
SMTP_PASSWORD=replace-me
SMTP_FROM=Repere <hello@example.com>
SMTP_SECURE=false
```

```sh
docker run -d --name repere --restart unless-stopped \
  -p 8080:8080 --stop-timeout 40 \
  -v repere-data:/data \
  --env-file .env.docker \
  synapsr/repere:0.3.0
```

Open [localhost:8080](http://localhost:8080). Initialization creates the secrets and database, applies migrations, then starts the application. Wait for the container to become healthy. The first initialization takes longer than a restart.

```sh
docker inspect --format '{{.State.Health.Status}}' repere
docker logs --tail 100 repere
```

A missing SMTP configuration does not prevent startup, but **users cannot sign in until email delivery works**. Port 587 usually uses STARTTLS with `SMTP_SECURE=false`; use `SMTP_SECURE=true` for implicit TLS, commonly on port 465. The single image does not include Mailpit; the [development stack](TESTING.md) provides a local inbox.

Use `localhost`, not a raw IP address, for local previews: session URLs look like `http://<48-hex-characters>.localhost:8080`. Public installations require HTTPS and wildcard DNS/TLS. To use another local port, change the host port and both URL settings together, for example `8081:8080` with URLs ending in `:8081`.

Do not copy the development Compose `.env` unchanged: its `DATABASE_URL` would select an external database. The minimal file above deliberately lets Repère use its integrated MySQL.

## EasyPanel

Create an **App** service with a Docker Image source. EasyPanel can pull a prebuilt image, persist mounted directories and route domains to a container port. Keep the image's startup command unchanged. [EasyPanel App documentation](https://easypanel.io/docs/services/app).

| Setting           | Value                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Image             | `synapsr/repere:0.3.0`, or the published digest                                                      |
| Container port    | **8080**                                                                                             |
| Persistent volume | Mount at **`/data`**                                                                                 |
| Replicas          | **1**                                                                                                |
| Deployment        | Stop the old container before starting its replacement; disable overlapping/zero-downtime deployment |
| Shutdown grace    | More than the default 30-second runtime shutdown window, for example 40 seconds                      |
| Command / user    | Leave the image defaults                                                                             |

Set environment variables using your own domains and SMTP service:

```dotenv
APP_URL=https://app.repere.dev
PREVIEW_BASE_URL=https://repere.dev
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=replace-me
SMTP_PASSWORD=replace-me
SMTP_FROM=Repere <hello@example.com>
SMTP_SECURE=false
```

Configure DNS and HTTPS routes:

| Public hostname  | Destination                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `app.repere.dev` | Repère App service, port **8080**                                               |
| `*.repere.dev`   | Repère App service, port **8080**                                               |
| `repere.dev`     | Your separate website, if any; do not route this apex to Repère in this example |

`PREVIEW_BASE_URL` is the parent of preview hostnames, not a page users visit. Keep exact application and apex website routes higher priority than the wildcard route; the apex website must reach its own service. The gateway accepts only the exact application hostname and valid 48-character preview subdomains. Unknown hostnames receive HTTP 421. Preserve the original `Host`, WebSocket upgrades and streaming responses through your ingress.

Provision a wildcard TLS certificate using a DNS challenge. In EasyPanel, configure the certificate resolver and select it for the wildcard domain; an ordinary certificate for `app.repere.dev` alone does not cover preview hosts. [EasyPanel wildcard-domain guide](https://easypanel.io/docs/guides/wildcard-domain).

Actual previews are distinct origins such as `https://<48-hex-characters>.repere.dev`. HTTPS authentication uses `__Host-repere_session`, scoped to the application host, and mutations verify their origin. A dedicated preview domain is also supported; a second registrable domain is not required.

Do not expose the internal ports 3000, 3001 or 3306. Do not mount the same integrated database volume into two running containers. The supervisor starts as root to prepare volume permissions; the application, gateway, preview and MySQL run under separate unprivileged service accounts. Overriding the image's user prevents initialization.

## Persistent data

Keep **all of `/data`** across container replacements:

| Path                 | Contents                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| `/data/mysql`        | Integrated MySQL database, including projects, accounts, sessions and comments       |
| `/data/uploads`      | Private uploaded PDF files                                                           |
| `/data/secrets.json` | Generated application/proxy secrets and integrated database credentials, mode `0600` |

The same volume remains necessary with external MySQL because uploads and generated secrets are still local. Environment overrides and SMTP credentials are not saved in this volume; retain that configuration separately and securely.

If database files exist but their secrets file is missing, startup fails instead of generating mismatched credentials. Restore the matching file from backup. Do not delete or edit it to reset a login problem.

For backups, stop the container cleanly before copying its whole data volume, or use a database-aware procedure coordinated with uploads. A raw copy of a running MySQL directory is not a consistent backup. Verify restores in an isolated installation.

Preview sessions are temporary memory state. After a restart, reopen the website preview; saved comments and PDFs remain available.

## External MySQL

Repère chooses its database in this order:

1. **`DATABASE_URL`**, when supplied.
2. **`MYSQL_HOST`** plus the complete credentials below.
3. **Integrated MySQL 8.4**, when neither external option is supplied.

For an existing MySQL 8.4 database, add these settings to the same private environment file:

```dotenv
MYSQL_HOST=mysql.example.com
MYSQL_PORT=3306
MYSQL_DATABASE=repere
MYSQL_USER=repere
MYSQL_PASSWORD=replace-me
```

The database and user must already exist. Give that user access to its Repère database, including the DDL permissions required by migrations. Repère waits for the connection and applies its versioned migrations automatically. It does not start an internal MySQL server in external mode. Partial `MYSQL_*` settings without `MYSQL_HOST` are rejected.

Alternatively, supply a properly URL-encoded connection string:

```dotenv
DATABASE_URL=mysql://repere:replace-me@mysql.example.com:3306/repere
```

For database TLS, use `DATABASE_URL` with its `ssl` query parameter containing URL-encoded mysql2 JSON TLS options. Certificate verification must remain enabled. Do not place actual credentials in committed files, terminal commands or issue reports.

Changing the connection settings does **not** transfer existing data. Plan a database dump/restore when moving from integrated to external MySQL, and preserve the matching uploads and application configuration.

## Optional configuration

| Setting                          | Default / purpose                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`, `PROXY_SECRET` | Generated and persisted automatically; optional independent overrides of at least 32 characters        |
| `ALLOWED_EMAIL_DOMAINS`          | Optional comma-separated domains allowed to create projects; shared-link reviewers remain unrestricted |
| `TRUST_PROXY`                    | `false`; enable only when a trusted ingress overwrites `X-Forwarded-For` and clients cannot bypass it  |
| `PREVIEW_MAX_SESSIONS`           | `100` concurrent in-memory sessions                                                                    |
| `PREVIEW_SESSION_TTL_MS`         | `3600000`, at most one hour                                                                            |
| `PREVIEW_MAX_HTML_BYTES`         | `8388608`, maximum decompressed HTML size                                                              |
| `DB_WAIT_TIMEOUT_MS`             | `120000`; supported range 1000–600000                                                                  |
| `MIGRATION_TIMEOUT_MS`           | `120000`; supported range 1000–600000                                                                  |
| `SHUTDOWN_TIMEOUT_MS`            | `30000`; supported range 1000–120000; set the container stop grace longer than this                    |

Internal addresses, ports and `UPLOAD_DIR` are managed by the image. Private demo access is enabled only for the local `http://localhost` application configuration. The image does not accept an arbitrary production private-host exception.

## Updates

Pin a published version or digest for production. Review the changelog and migrations, back up the data, then replace the container using the same volume and environment:

```sh
docker stop --time 40 repere
docker rm repere
```

Run the startup command again with the intended image version. Removing the container does not remove the named `repere-data` volume. Allow a maintenance window: one integrated database cannot be shared by old and new containers running simultaneously.

Migrations run on every start and apply pending changes. MySQL schema changes are not universally transactional; rolling back an image does not reverse a migration. Keep a tested restore plan. The current preview service and local file storage support one instance, including with an external database.

## Build the image from source

No local Node.js installation is needed for this image build:

```sh
git clone https://github.com/Synapsr/Repere.git
cd Repere
docker build -f Dockerfile.all-in-one -t repere:local .
```

Use `repere:local` in place of `synapsr/repere:0.3.0` in the startup command. The first build downloads dependencies and compiles Next.js and the preview service; allow several minutes depending on the host and network. For separate services or application development, use the [Compose setup](DEPLOYMENT.md#local-setup).

Repère's application source is MIT licensed. The image also contains upstream software under its respective licenses, including MySQL; keep the image's bundled notices when redistributing it. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Publishing the image

The [Docker Hub workflow](../.github/workflows/docker-publish.yml) builds the version selected by an existing SemVer Git tag using SHA-pinned official actions. It runs dependency auditing, formatting, linting, TypeScript and unit checks before the multi-platform image build.

Maintainers must configure these repository secrets before publishing:

- `DOCKERHUB_USERNAME`: an account allowed to push to `synapsr/repere`.
- `DOCKERHUB_TOKEN`: that account's scoped Docker Hub access token.

No registry credentials are included in the repository. A published GitHub release triggers publication. Manual runs require an existing version tag and default to **build only**; enable the `publish` input to push.

| Git tag / release        | Docker tags                   |
| ------------------------ | ----------------------------- |
| Stable `v0.3.0`          | `0.3.0`, `0.3`, `latest`      |
| Stable `v1.2.3`          | `1.2.3`, `1.2`, `1`, `latest` |
| Prerelease `v1.3.0-rc.1` | `1.3.0-rc.1` only             |

`0.3.0`, `0.3` and `latest` identify the current release. The earlier `0.1.0`, `0.1.1`, `0.1`, `0.2.0` and `0.2` tags retain their existing images and digests. The `1.x` rows illustrate future tag formats. A GitHub release explicitly marked as prerelease does not update stable aliases. The workflow targets AMD64 and ARM64 and requests provenance/SBOM attestations. A successful build is not a substitute for runtime smoke tests on the intended host. [Docker multi-platform CI documentation](https://docs.docker.com/build/ci/github-actions/multi-platform/).

## Smoke checks after deployment

Before inviting reviewers, verify the actual deployed image and its configured services:

1. Wait for a healthy container, receive a real email code and sign in.
2. Create a website project, navigate its native preview and save a point/comment. Upload a PDF, change its page and save a second comment.
3. Restart the container, then replace it with the same volume. Confirm identities, projects, comments and PDF bytes persist, and that generated secrets are retained without printing them.
4. Reopen a preview and verify its TLS certificate, navigation, cookies and representative site functionality. Unknown gateway hosts and public preview-control requests must be refused.
5. If using external MySQL, repeat the flow against that database and verify the image did not start an integrated database process.
6. Restore a backup into a separate installation and verify a project and PDF there.

Health checks cover the app's database access, preview service and gateway; they do not prove SMTP delivery, public DNS/TLS or universal website compatibility.

## Français

### Démarrer avec Docker

L'image `synapsr/repere` contient l'application, le service d'aperçu natif et **MySQL 8.4**. Un seul port est exposé : **8080**. Le volume **`/data`** conserve la base, les PDF et les secrets générés. Les migrations sont automatiques.

**[La version 0.3.0 est publiée sur Docker Hub](https://hub.docker.com/r/synapsr/repere)** pour Linux AMD64 et ARM64. Les deux variantes ont passé le démarrage avec MySQL intégré, les migrations et les contrôles de santé, puis une vérification anonyme de leurs manifests publics. Le digest commun figure en tête de ce guide. Vous pouvez aussi [construire l’image depuis les sources](#build-the-image-from-source).

Créez `.env.docker` avec les variables du [démarrage Docker](#start-with-docker), en remplaçant les paramètres SMTP par ceux de votre fournisseur, puis exécutez :

```sh
docker run -d --name repere --restart unless-stopped \
  -p 8080:8080 --stop-timeout 40 \
  -v repere-data:/data \
  --env-file .env.docker \
  synapsr/repere:0.3.0
```

Ouvrez [localhost:8080](http://localhost:8080) lorsque le conteneur est sain. Les URL locales `APP_URL` et `PREVIEW_BASE_URL` valent toutes deux `http://localhost:8080`. Les sous-domaines temporaires isolent chaque aperçu. SMTP est indispensable pour recevoir les codes de connexion ; aucun compte ne peut se connecter tant que l'envoi des emails ne fonctionne pas.

### EasyPanel en pratique

1. Créez un service **App**, source **Docker Image**, image `synapsr/repere:0.3.0` ou le digest publié.
2. Utilisez le port cible **8080** et montez un volume persistant sur **`/data`**. Conservez la commande et l'utilisateur par défaut de l'image.
3. Gardez **une seule réplique**. Désactivez les déploiements avec chevauchement : l'ancien conteneur doit être arrêté avant le nouveau, pour éviter que deux MySQL ouvrent le même volume. Accordez au moins 40 secondes à l'arrêt avec les réglages par défaut.
4. Renseignez votre SMTP, puis vos domaines, par exemple `APP_URL=https://app.repere.dev` et `PREVIEW_BASE_URL=https://repere.dev`.
5. Dirigez `app.repere.dev` et `*.repere.dev` vers le service Repère, port **8080**, avec HTTPS. Conservez les routes exactes de l’application et du site prioritaires sur le wildcard. Le domaine nu `repere.dev` peut accueillir un site distinct sur son propre service : il ne sert pas les aperçus dans cet exemple.
6. Configurez le certificat wildcard via un challenge DNS, puis testez un code email, une relecture de site et un PDF depuis les vraies URL publiques. Le [guide EasyPanel wildcard](https://easypanel.io/docs/guides/wildcard-domain) détaille le résolveur de certificat.

Les aperçus utilisent des origines différentes, du type `https://<48-caractères-hexadécimaux>.repere.dev`. En HTTPS, le cookie de connexion `__Host-repere_session` reste attaché à l'hôte applicatif. Un domaine dédié aux aperçus reste possible, sans obligation d'utiliser un autre domaine enregistrable.

### Données, MySQL externe et mises à jour

Conservez **tout `/data`** : `mysql/`, `uploads/` et `secrets.json`. Sauvegardez aussi votre configuration SMTP et vos éventuelles variables secrètes. Arrêtez proprement le conteneur avant une copie complète du volume, ou utilisez une sauvegarde adaptée à MySQL et coordonnée avec les PDF. Testez la restauration.

Pour une base MySQL 8.4 externe, renseignez `MYSQL_HOST`, `MYSQL_PORT` (3306 par défaut), `MYSQL_DATABASE`, `MYSQL_USER` et `MYSQL_PASSWORD`. La base et son utilisateur doivent exister et autoriser les migrations. Une `DATABASE_URL` complète prend priorité sur ces variables. Le MySQL intégré ne démarre pas dans ce mode ; `/data` reste nécessaire pour les PDF et les secrets. Voir [la configuration externe](#external-mysql), notamment pour TLS.

Changer de connexion ne transfère pas les données existantes : prévoyez un export/import et conservez les PDF correspondants. Lors d'une mise à jour, sauvegardez, arrêtez l'ancien conteneur, puis recréez-le avec la même configuration et le même volume. Une ancienne image ne peut pas annuler une migration SQL. Les sessions d'aperçu se rouvrent après redémarrage ; les projets et conversations restent enregistrés.

Pour modifier le code ou disposer d'une boîte Mailpit locale, utilisez le [développement depuis les sources](../README.fr.md#développer-depuis-les-sources). Ce mode Compose reste distinct de l'image unique.
