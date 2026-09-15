# Security policy

Repère is an early release. Its access controls and tests do not constitute an independent security audit. There is no established support window or response-time commitment yet.

## Report a vulnerability privately

Do not put secrets, live sharing links, customer documents or exploit details in a public issue.

Use [GitHub's private vulnerability-reporting form](https://github.com/Synapsr/Repere/security/advisories/new). Private reporting is enabled for the official repository. There is no dedicated security email address or response-time commitment.

If you publish a fork, enable its own private reporting channel or list a verified private security contact before inviting reports.

A useful private report includes:

- The version or commit and deployment mode.
- A minimal reproduction using synthetic data and a site you control.
- The affected boundary and observed impact.
- Relevant redacted logs or a proposed fix, if available.

## Boundaries to understand

- A project link plus a verified email permits participation. Treat the sharing link as access to a trusted group, not as a public identifier.
- Names are self-declared. Email possession is verified, and signed-in participants can see authors' email addresses.
- `ALLOWED_EMAIL_DOMAINS` restricts project creation, not guest participation.
- The application and website previews need separate registrable domains in production. The proxy adapts embedding restrictions to enable review; the site's DOM and scripts remain untrusted.
- A preview hostname is a temporary access capability. Keep it out of public logs. The proxy stores the destination, not a shared server-side cookie jar for the website.
- DNS/IP filtering protects the proxy's outgoing connections. Third-party requests made by the site's scripts remain subject to the reviewer's browser and the site's behavior.
- Archiving or rotating a link blocks unauthorized new API requests. A previously opened preview can continue until its session expires, at most one hour.
- PDFs are private and authenticated. Checking `%PDF-` identifies the file type; it is not antivirus scanning or full document validation. Keep PDF.js and its matching decoder assets current.
- `TRUST_PROXY` defaults to false. Enable it only behind a trusted proxy that overwrites the client-IP header and prevents direct application access.
- The locale cookie controls language only; it grants no access to projects or sessions.

## Operate a public instance

Configure HTTPS, an isolated wildcard preview domain, reliable SMTP, backups and traffic limits appropriate to your hosting environment. Do not enable the local private-network exception in production. Review the deployment's cookie behavior and test representative websites before sharing it with clients.

The app health endpoint checks MySQL; it does not prove SMTP or website-preview compatibility. Back up both the database and uploaded files. Plan retention and deletion procedures for your instance; account deletion and user-facing export tools are not yet implemented.

See [deployment](docs/DEPLOYMENT.md), [preview architecture](docs/PREVIEW.md), [backend controls](docs/BACKEND.md) and [testing](docs/TESTING.md).
