import { isIP } from "node:net";

export class RuntimeError extends Error {}

function invalid(name, expectation) {
  throw new RuntimeError(`${name} ${expectation}.`);
}

export function integerSetting(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) invalid(name, "must be an integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    invalid(name, `must be between ${minimum} and ${maximum}`);
  return number;
}

function publicOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(name, "must be an HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    invalid(name, "must be an HTTP(S) origin without credentials or a path");
  return url;
}

export function databaseConfiguration(env) {
  if (env.DATABASE_URL) {
    let url;
    try {
      url = new URL(env.DATABASE_URL);
      for (const value of [url.hostname, url.username, url.password, url.pathname])
        decodeURIComponent(value);
    } catch {
      invalid("DATABASE_URL", "must be a valid MySQL connection URL");
    }
    if (
      url.protocol !== "mysql:" ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !url.pathname.slice(1) ||
      decodeURIComponent(url.pathname.slice(1)).includes("/") ||
      /[\u0000-\u001f]/.test(decodeURIComponent(url.pathname)) ||
      url.hash
    )
      invalid("DATABASE_URL", "must contain a MySQL host, user, password and database");
    if (url.port) integerSetting(url.port, 3306, "DATABASE_URL port", 1, 65535);
    // mysql2's URI parser passes bracketed IPv6 literals to DNS unchanged. A DNS name works.
    if (url.hostname.startsWith("[")) invalid("DATABASE_URL", "must use a DNS host for IPv6");
    for (const key of url.searchParams.keys()) {
      if (key !== "ssl" || url.searchParams.getAll(key).length !== 1)
        invalid("DATABASE_URL query", "supports only one ssl JSON option");
      let ssl;
      try {
        ssl = JSON.parse(url.searchParams.get(key));
      } catch {
        invalid("DATABASE_URL ssl", "must be a JSON TLS configuration");
      }
      if (!ssl || typeof ssl !== "object" || Array.isArray(ssl) || ssl.rejectUnauthorized === false)
        invalid("DATABASE_URL ssl", "must verify the server certificate");
    }
    return { mode: "external", url: url.href };
  }

  if (env.MYSQL_HOST) {
    const host = env.MYSQL_HOST;
    if (
      host !== host.trim() ||
      /[\s/@?#\\]/.test(host) ||
      host.includes(":") ||
      host.startsWith("[") ||
      isIP(host) === 6
    )
      invalid("MYSQL_HOST", "must be a DNS name or IPv4 address without a port");
    for (const key of ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"])
      if (!env[key] || /[\u0000-\u001f]/.test(env[key]))
        invalid(key, "is required with MYSQL_HOST");
    if (env.MYSQL_DATABASE.includes("/")) invalid("MYSQL_DATABASE", "must be one database name");
    const port = integerSetting(env.MYSQL_PORT, 3306, "MYSQL_PORT", 1, 65535);
    const url = new URL(`mysql://${host}:${port}/`);
    if (url.hostname !== host.toLowerCase()) invalid("MYSQL_HOST", "must be a literal host name");
    url.username = encodeURIComponent(env.MYSQL_USER);
    url.password = encodeURIComponent(env.MYSQL_PASSWORD);
    url.pathname = `/${encodeURIComponent(env.MYSQL_DATABASE)}`;
    return { mode: "external", url: url.href };
  }
  if (["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE", "MYSQL_PORT"].some((key) => env[key]))
    invalid("MYSQL_HOST", "is required when external MySQL settings are supplied");
  return { mode: "local" };
}

export function runtimeConfiguration(env) {
  const app = publicOrigin(env.APP_URL || "http://localhost:8080", "APP_URL");
  const local = app.protocol === "http:" && app.hostname === "localhost";
  if (!local && app.protocol !== "https:") invalid("APP_URL", "must use HTTPS outside localhost");
  if (!local && !env.PREVIEW_BASE_URL)
    invalid("PREVIEW_BASE_URL", "is required for a public deployment");
  const preview = publicOrigin(env.PREVIEW_BASE_URL || app.origin, "PREVIEW_BASE_URL");
  if (!local && (preview.protocol !== "https:" || isIP(preview.hostname)))
    invalid(
      "PREVIEW_BASE_URL",
      "must use HTTPS on a domain supporting isolated preview subdomains",
    );
  if (preview.protocol !== "https:" && preview.hostname !== "localhost")
    invalid("PREVIEW_BASE_URL", "must use HTTPS outside localhost");
  if (env.SMTP_PORT) integerSetting(env.SMTP_PORT, 587, "SMTP_PORT", 1, 65535);
  for (const key of ["SMTP_SECURE", "TRUST_PROXY"])
    if (env[key] && !["true", "false"].includes(env[key])) invalid(key, "must be true or false");
  for (const key of ["SESSION_SECRET", "PROXY_SECRET"])
    if (env[key] && (env[key].length < 32 || /[\u0000-\u001f]/.test(env[key])))
      invalid(key, "must contain at least 32 characters without control characters");
  return {
    appUrl: app.origin,
    previewBaseUrl: preview.origin,
    local,
    database: databaseConfiguration(env),
    dbWaitMs: integerSetting(env.DB_WAIT_TIMEOUT_MS, 120000, "DB_WAIT_TIMEOUT_MS", 1000, 600000),
    migrationMs: integerSetting(
      env.MIGRATION_TIMEOUT_MS,
      120000,
      "MIGRATION_TIMEOUT_MS",
      1000,
      600000,
    ),
    shutdownMs: integerSetting(env.SHUTDOWN_TIMEOUT_MS, 30000, "SHUTDOWN_TIMEOUT_MS", 1000, 120000),
  };
}

function selected(env, keys) {
  return Object.fromEntries(
    keys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  );
}

export function serviceEnvironments(env, config, secrets) {
  const system = {
    PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
    NODE_ENV: "production",
    TZ: "UTC",
    HOME: "/home/node",
  };
  const urls = { APP_URL: config.appUrl, PREVIEW_BASE_URL: config.previewBaseUrl };
  const sessionSecret = env.SESSION_SECRET || secrets.sessionSecret;
  const proxySecret = env.PROXY_SECRET || secrets.proxySecret;
  if (sessionSecret === proxySecret)
    invalid("SESSION_SECRET and PROXY_SECRET", "must be different");
  const databaseUrl =
    config.database.mode === "external"
      ? config.database.url
      : `mysql://repere:${secrets.mysqlPassword}@127.0.0.1:3306/repere`;
  return {
    migration: { ...system, DATABASE_URL: databaseUrl },
    app: {
      ...system,
      ...urls,
      ...selected(env, [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "SMTP_FROM",
        "SMTP_SECURE",
        "ALLOWED_EMAIL_DOMAINS",
        "TRUST_PROXY",
      ]),
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: sessionSecret,
      PROXY_SECRET: proxySecret,
      PROXY_INTERNAL_URL: "http://127.0.0.1:3001",
      UPLOAD_DIR: "/data/uploads",
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
      NEXT_TELEMETRY_DISABLED: "1",
      ...(config.local ? { DEMO_SITE_URL: "http://127.0.0.1:3000/demo-site" } : {}),
    },
    preview: {
      ...system,
      ...urls,
      ...selected(env, [
        "PREVIEW_MAX_SESSIONS",
        "PREVIEW_SESSION_TTL_MS",
        "PREVIEW_MAX_HTML_BYTES",
      ]),
      PROXY_SECRET: proxySecret,
      PORT: "3001",
      PREVIEW_BIND_HOST: "127.0.0.1",
      PREVIEW_BRIDGE_PATH: "/app/preview/bridge.js",
      ...(config.local ? { PREVIEW_ALLOWED_PRIVATE_HOSTS: "127.0.0.1" } : {}),
    },
    gateway: { ...system, ...urls, ...selected(env, ["TRUST_PROXY"]), PORT: "8080" },
    mysql: {
      PATH: system.PATH,
      TZ: "UTC",
      HOME: "/var/lib/mysql",
      ...selected(env, ["MYSQL_VERSION", "MYSQL_MAJOR", "MYSQL_SHELL_VERSION"]),
      MYSQL_DATABASE: "repere",
      MYSQL_USER: "repere",
      MYSQL_PASSWORD: secrets.mysqlPassword,
      MYSQL_ROOT_PASSWORD: secrets.mysqlRootPassword,
      MYSQL_ROOT_HOST: "localhost",
      MYSQL_INITDB_SKIP_TZINFO: "1",
    },
  };
}
