# EasyPanel: application and preview services

[README](../README.md) · [Français](#français) · [Single-container alternative](DOCKER.md)

Use this setup when you already have a **MySQL 8.4 database** and want separate EasyPanel services. Repère needs two services built from the public [Synapsr/Repere repository](https://github.com/Synapsr/Repere): the application and the native preview proxy. A separate project website is optional and has its own deployment.

The published [all-in-one Docker image](DOCKER.md), `synapsr/repere:0.1.1`, remains an alternative with one gateway and optional integrated MySQL. Do not mix its port 8080 and `/data` settings with the two-service configuration below.

## Services and domains

Replace these example domains with your own:

| Service           | Build                                                       | Container port                                | Public domain        | Persistent storage             |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------- | -------------------- | ------------------------------ |
| Application       | Repository-root `Dockerfile`                                | **3000**                                      | `app.repere.dev`     | **`/app/uploads`**             |
| Preview           | `preview/Dockerfile`, with repository root as build context | **3001**                                      | **`*.repere.dev`**   | None                           |
| Website, optional | Its own repository, for example using Nixpacks              | **3002** in the example website configuration | `repere.dev`         | Managed by that project        |
| Existing MySQL    | Your current database service                               | Usually 3306, internal                        | No public web domain | Your existing database storage |

The website is independent of the application. It does not need the application's database, authentication secrets or SMTP credentials. This guide does not require the private website repository to run Repère.

In EasyPanel, create two **App** services with the same Repère source revision and select their Dockerfiles. Keep each image's startup command unchanged. Configure the target port in its domain settings; do not publish database or internal service ports directly on the host. EasyPanel documents Dockerfile builds, internal service networking, mounts and domain routing in its [App service guide](https://easypanel.io/docs/services/app).

## 1. Prepare the database and secrets

Use an existing database dedicated to Repère and a user allowed to read/write it and apply schema migrations. Encode special characters in the username and password when constructing `DATABASE_URL`. An empty Repère database is initialized by the application's migrations; the database server, database and user must already exist.

Generate **two independent secrets**, each at least 32 random bytes. Keep them in EasyPanel's environment settings or private ignored environment files:

- `SESSION_SECRET` belongs only to the application.
- `PROXY_SECRET` must have the **same value in the application and preview services**.

Preserve these values across deployments. Unlike the all-in-one image, these separate images do not generate a persistent secrets file automatically. Never paste real values into the public repository, issues or screenshots.

## 2. Configure the preview service

Build using `preview/Dockerfile` and the **repository root as context**. The Dockerfile needs `package.json`, `shared/` and build scripts outside the `preview/` directory.

```dotenv
APP_URL=https://app.repere.dev
PREVIEW_BASE_URL=https://repere.dev
PROXY_SECRET=replace-with-the-shared-random-secret
PORT=3001
PREVIEW_MAX_SESSIONS=100
PREVIEW_SESSION_TTL_MS=3600000
PREVIEW_MAX_HTML_BYTES=8388608
```

Use **one replica**: preview sessions currently live in memory. Do not configure `PREVIEW_ALLOWED_PRIVATE_HOSTS` in production. The service needs outbound access to public websites and DNS; it does not need database or SMTP access.

Attach the HTTPS wildcard domain **`*.repere.dev`** to this service on port **3001**. Session addresses are `https://<48-hex-characters>.repere.dev`; `PREVIEW_BASE_URL=https://repere.dev` supplies their parent domain. The apex `repere.dev` remains the separate website, not a preview session or a public control API. Do not add a public route for `/__repere/sessions`.

Keep exact routes for **`app.repere.dev` → application:3000** and **`repere.dev` → website:3002** with higher routing priority than the wildcard preview route. In particular, `app.repere.dev` also matches `*.repere.dev` and must never be sent to the preview service. Preserve the exact website route independently; a wildcard subdomain does not include the apex.

Create the wildcard DNS record and a TLS certificate covering **`*.repere.dev`**. This covers each one-level session hostname; the apex website needs its own certificate or explicit `repere.dev` certificate name. Adding the wildcard domain or DNS record alone does not issue this certificate. EasyPanel requires a working **DNS-01 certificate resolver**, with its DNS provider configuration and credentials, selected for the wildcard route. With OVH DNS, configure an OVH-capable resolver or another supported DNS-01 validation arrangement. A missing resolver leaves certificate issuance blocked. See the [wildcard-domain guide](https://easypanel.io/docs/guides/wildcard-domain).

Preserve the original `Host`, WebSocket upgrades and streaming responses at ingress. Avoid overlapping preview replicas during deployment; reopening a preview creates a fresh session after its service restarts.

## 3. Configure the application service

Build the repository-root `Dockerfile`. Mount a persistent volume at **`/app/uploads`** for private PDFs, writable by the image's application user (UID/GID **1001**). Keep one application replica with this local storage configuration.

```dotenv
APP_URL=https://app.repere.dev
PREVIEW_BASE_URL=https://repere.dev
PROXY_INTERNAL_URL=http://repere_preview:3001
PROXY_SECRET=replace-with-the-same-shared-random-secret
SESSION_SECRET=replace-with-an-independent-random-secret
DATABASE_URL=mysql://repere:replace-me@mysql.internal:3306/repere
UPLOAD_DIR=/app/uploads
PORT=3000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=replace-me
SMTP_PASSWORD=replace-me
SMTP_FROM=Repere <hello@example.com>
SMTP_SECURE=false
TRUST_PROXY=false
ALLOWED_EMAIL_DOMAINS=
```

`repere_preview` is the internal hostname in this example. Replace it with the exact hostname EasyPanel gives your preview service, and ensure both services can reach each other on the internal Docker network. `localhost` inside the application container refers to that container, not to the preview or database service. `PROXY_INTERNAL_URL` must use the internal service address, while `PREVIEW_BASE_URL` must remain the public HTTPS origin used by browsers.

Replace the database URL with your existing database's internal address and credentials. The standard application image uses `DATABASE_URL`; the all-in-one image's `MYSQL_HOST` shorthand does not apply here. If your external database requires TLS, use the connection configuration supported by your mysql2 provider and retain certificate verification.

At startup, the application waits for the database and applies pending Drizzle migrations before serving requests. `DB_WAIT_TIMEOUT_MS` and `MIGRATION_TIMEOUT_MS` default to 120000 milliseconds each. Keep the image's default command so this startup step runs. A connection or migration failure stops startup; inspect the service logs, database permissions and connectivity instead of bypassing migrations.

Configure real SMTP before inviting reviewers. Port 587 typically uses STARTTLS with `SMTP_SECURE=false`; port 465 typically requires `SMTP_SECURE=true`. A healthy application does not prove that email can be delivered.

`ALLOWED_EMAIL_DOMAINS` optionally restricts who can create projects. Reviewers using a shared link may use other email domains. Enable `TRUST_PROXY` only if your ingress overwrites `X-Forwarded-For` and direct client access is blocked.

Attach **`app.repere.dev`** to the application on port **3000**, with HTTPS. Keep the website's `repere.dev` route on its own service. Set the application's `APP_URL` and the preview service's `APP_URL` to the same exact origin.

## 4. Verify the deployment

Deploy the preview service and application using the same source revision. Check the real public URLs before sharing a project:

1. The application becomes healthy after its database connection and migrations succeed.
2. A real email code arrives and signs you in at `app.repere.dev`.
3. A website project opens under a random 48-character subdomain of `repere.dev`, with a valid certificate and working navigation.
4. A point and comment persist after refreshing the application. A PDF uploads, renders and retains its comments.
5. After redeployment, the same database, uploads volume and secrets retain projects, accounts and PDF files. Restarted previews reopen normally.
6. Exact-host routing still sends `app.repere.dev` to the application and `repere.dev` to the independent website, while a valid session hostname reaches the preview. Internal control/database endpoints remain private.

The application's health endpoint is `/api/health`. The preview's `/health` endpoint is available on its internal service address. These checks do not validate DNS, certificates, SMTP or compatibility with every website. See the [verification record](VERIFICATION.md) for completed project tests.

## Backups and updates

Back up the existing MySQL database, the application's uploads volume and its environment configuration together. Use database-aware backups and verify restoration. Preview sessions are temporary and do not require a volume.

Keep one application and one preview replica. During updates, avoid overlapping migration processes and use the same source revision for both services. Review migrations and the changelog before deployment: an image rollback does not reverse a database schema change.

For a Compose installation, see [DEPLOYMENT.md](DEPLOYMENT.md). For the single-container image with port 8080 and `/data`, see [DOCKER.md](DOCKER.md).

## Français

### Deux services Repère, votre MySQL existant

Cette configuration sépare **l'application** et **le proxy d'aperçu**. Le site vitrine reste un projet indépendant. Dans EasyPanel :

| Service                 | Construction                                                      | Port                      | Domaine            |
| ----------------------- | ----------------------------------------------------------------- | ------------------------- | ------------------ |
| Application             | `Dockerfile` à la racine du dépôt public Repère                   | **3000**                  | `app.repere.dev`   |
| Aperçu                  | `preview/Dockerfile`, contexte de build à la racine du même dépôt | **3001**                  | **`*.repere.dev`** |
| Site vitrine facultatif | Son propre dépôt, Nixpacks selon sa configuration                 | **3002** dans cet exemple | `repere.dev`       |

Utilisez les blocs de variables des sections [aperçu](#2-configure-the-preview-service) et [application](#3-configure-the-application-service), avec vos propres identifiants. Dans les deux services, `APP_URL=https://app.repere.dev` et `PREVIEW_BASE_URL=https://repere.dev` doivent correspondre exactement. **`PROXY_SECRET` doit être identique** ; `SESSION_SECRET` reste réservé à l'application et différent de `PROXY_SECRET`.

L'application appelle le proxy par **`PROXY_INTERNAL_URL=http://repere_preview:3001`**. Remplacez `repere_preview` si EasyPanel indique un autre nom interne. La base externe utilise **`DATABASE_URL`**, avec une base et un utilisateur déjà créés et autorisés à appliquer les migrations. Conservez la commande par défaut : elle attend MySQL et lance les migrations avant le démarrage du serveur.

Montez un volume persistant sur **`/app/uploads`**, accessible à l'UID/GID 1001. Préservez ce volume, la base et les secrets lors des mises à jour. Gardez une seule réplique par service. Le proxy ne demande aucun volume et ses aperçus se rouvrent après redémarrage.

Configurez un vrai SMTP pour recevoir les codes de connexion. Dirigez **`*.repere.dev` vers le port 3001 du proxy** : chaque aperçu utilise `https://<48-caractères-hexadécimaux>.repere.dev`. Donnez aux routes exactes **`app.repere.dev` → application:3000** et **`repere.dev` → site:3002** une priorité supérieure à celle du wildcard. L'application correspond aussi au wildcard ; sa route exacte doit donc rester prioritaire. Le domaine nu reste une route indépendante pour le site vitrine.

Un certificat **`*.repere.dev` couvre ces aperçus sur un seul niveau**, mais pas le domaine nu, qui demande son propre nom dans un certificat. Ajouter le domaine wildcard et son DNS ne suffit pas : configurez un **résolveur DNS-01 fonctionnel**, avec le fournisseur DNS et ses identifiants, puis sélectionnez-le pour cette route EasyPanel. Pour une zone OVH, utilisez un résolveur compatible OVH ou une autre configuration DNS-01 prise en charge. Sans résolveur, l'émission du certificat reste bloquée.

Avant d'inviter vos clients, testez un code email, la navigation dans un site, un commentaire, un PDF et leur conservation après redéploiement. Les contrôles de santé ne suffisent pas à valider SMTP, DNS et TLS.

L'[image Docker tout-en-un publiée](DOCKER.md#français), `synapsr/repere:0.1.1`, reste un autre mode de déploiement : elle utilise **8080** et **`/data`**, avec MySQL intégré ou externe. Ces réglages ne sont pas ceux des deux services décrits ici.
