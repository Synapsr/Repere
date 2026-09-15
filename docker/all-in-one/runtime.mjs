#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { RuntimeError, runtimeConfiguration, serviceEnvironments } from "./config.mjs";
import { loadOrCreateSecrets, prepareServiceDirectories } from "./secrets.mjs";

async function initializationDaemonPid() {
  try {
    const text = (await readFile("/run/mysqld/mysqld.pid", "utf8")).trim();
    if (!/^[1-9]\d{0,9}$/.test(text) || Number(text) <= 1) return null;
    const [command, status, directory] = await Promise.all([
      readFile(`/proc/${text}/cmdline`, "utf8"),
      readFile(`/proc/${text}/status`, "utf8"),
      stat("/data/mysql"),
    ]);
    const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
    const args = command.split("\0");
    if (
      uid === 0 ||
      uid !== directory.uid ||
      !args[0]?.endsWith("mysqld") ||
      !args.includes("--datadir=/data/mysql")
    )
      return null;
    return Number(text);
  } catch {
    return null;
  }
}

export class Supervisor {
  constructor({ shutdownMs = 30000, stdio = "inherit" } = {}) {
    this.shutdownMs = shutdownMs;
    this.stdio = stdio;
    this.entries = [];
    this.stopping = false;
    this.controller = new AbortController();
    this.failure = new Promise((resolve) => {
      this.resolveFailure = resolve;
    });
  }

  fail(error) {
    if (this.controller.signal.aborted) return;
    this.controller.abort(error);
    this.resolveFailure(error);
  }

  start(name, command, args, options = {}) {
    this.controller.signal.throwIfAborted();
    const { essential = true, ...spawnOptions } = options;
    const child = spawn(command, args, {
      detached: true,
      stdio: this.stdio,
      ...spawnOptions,
    });
    const entry = { name, child, done: null, exited: false };
    entry.done = new Promise((resolve) => {
      const complete = (code) => {
        if (entry.exited) return;
        entry.exited = true;
        resolve(code);
        if (essential && !this.stopping)
          this.fail(
            new RuntimeError(
              `${name} stopped unexpectedly. The container will restart all services.`,
            ),
          );
      };
      child.once("error", () => complete(1));
      child.once("exit", (code) => complete(code ?? 1));
    });
    this.entries.push(entry);
    return entry;
  }

  race(work) {
    return Promise.race([
      work,
      this.failure.then((error) => {
        throw error;
      }),
    ]);
  }

  signalGroup(entry, signal) {
    if (!entry.child.pid) return;
    try {
      process.kill(-entry.child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  async stopEntries(entries, timeoutMs) {
    for (const entry of entries) this.signalGroup(entry, "SIGTERM");
    let timer;
    await Promise.race([
      Promise.all(entries.map((entry) => entry.done)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    // Also remove subprocesses whose leader has already exited (for example a shell entrypoint).
    for (const entry of entries) this.signalGroup(entry, "SIGKILL");
    await Promise.all(entries.map((entry) => entry.done));
  }

  async shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopping = true;
    this.shutdownPromise = (async () => {
      await this.stopEntries(
        this.entries.filter((entry) => entry.name !== "mysql"),
        Math.floor(this.shutdownMs / 3),
      );
      const mysqlEntries = this.entries.filter((entry) => entry.name === "mysql");
      const deadline = Date.now() + Math.floor((this.shutdownMs * 2) / 3);
      // Official first-run initialization temporarily daemonizes mysqld outside the entrypoint's group.
      const daemon = mysqlEntries.length ? await initializationDaemonPid() : null;
      if (daemon) {
        try {
          process.kill(daemon, "SIGTERM");
        } catch {}
      }
      await this.stopEntries(mysqlEntries, Math.floor((this.shutdownMs * 2) / 3));
      while (daemon && (await initializationDaemonPid()) === daemon) {
        if (Date.now() >= deadline) {
          try {
            process.kill(daemon, "SIGKILL");
          } catch {}
          break;
        }
        await sleep(100);
      }
    })();
    return this.shutdownPromise;
  }
}

export async function waitForDatabase(url, { timeoutMs = 120000, signal, connect } = {}) {
  const createConnection = connect ?? (await import("mysql2/promise")).createConnection;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    let connection;
    try {
      connection = await createConnection({
        uri: url,
        timezone: "Z",
        connectTimeout: Math.min(2000, deadline - Date.now()),
      });
      signal?.throwIfAborted();
      await connection.query({
        sql: "SELECT 1",
        timeout: Math.max(1, Math.min(2000, deadline - Date.now())),
      });
      return;
    } catch {
      signal?.throwIfAborted();
    } finally {
      connection?.destroy();
    }
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  throw new RuntimeError(
    "Database did not become ready within DB_WAIT_TIMEOUT_MS. Check connection settings or restore an interrupted initial MySQL setup.",
  );
}

export async function runRuntime(env = process.env) {
  if (process.getuid?.() !== 0)
    throw new RuntimeError(
      "The all-in-one supervisor must start as root; child services use dedicated unprivileged users.",
    );
  process.umask(0o077);
  const config = runtimeConfiguration(env);
  const secrets = await loadOrCreateSecrets();
  const environments = serviceEnvironments(env, config, secrets);
  await prepareServiceDirectories();
  const supervisor = new Supervisor({ shutdownMs: config.shutdownMs });
  let requestedStop = false;
  const stop = () => {
    requestedStop = true;
    supervisor.stopping = true;
    supervisor.fail(new RuntimeError("Container shutdown requested."));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const nodeOptions = (service) => {
    const id = service === "preview" ? 1001 : service === "gateway" ? 1002 : 1000;
    return { cwd: "/app", env: environments[service], uid: id, gid: id };
  };
  try {
    console.info(
      `Repère: starting with ${config.database.mode === "local" ? "persistent integrated" : "external"} MySQL.`,
    );
    if (config.database.mode === "local")
      supervisor.start(
        "mysql",
        "/usr/local/bin/docker-entrypoint.sh",
        [
          "mysqld",
          "--datadir=/data/mysql",
          "--socket=/run/mysqld/mysqld.sock",
          "--pid-file=/run/mysqld/mysqld.pid",
          "--bind-address=127.0.0.1",
          "--port=3306",
          "--mysqlx=OFF",
          "--default-time-zone=+00:00",
          "--character-set-server=utf8mb4",
          "--collation-server=utf8mb4_unicode_ci",
        ],
        { env: environments.mysql },
      );
    await supervisor.race(
      waitForDatabase(environments.migration.DATABASE_URL, {
        timeoutMs: config.dbWaitMs,
        signal: supervisor.controller.signal,
      }),
    );
    console.info("Repère: database ready; applying migrations.");
    const migration = supervisor.start("migration", process.execPath, ["/app/migrate.mjs"], {
      ...nodeOptions("migration"),
      essential: false,
    });
    const migrationTimeout = setTimeout(
      () => supervisor.fail(new RuntimeError("Database migration exceeded MIGRATION_TIMEOUT_MS.")),
      config.migrationMs,
    );
    let result;
    try {
      result = await supervisor.race(migration.done);
    } finally {
      clearTimeout(migrationTimeout);
    }
    if (result !== 0)
      throw new RuntimeError("Database migration failed. Application services were not started.");
    supervisor.start("application", process.execPath, ["/app/server.js"], nodeOptions("app"));
    supervisor.start(
      "preview",
      process.execPath,
      ["/app/preview/server.mjs"],
      nodeOptions("preview"),
    );
    supervisor.start(
      "gateway",
      process.execPath,
      ["/app/docker/all-in-one/gateway.mjs"],
      nodeOptions("gateway"),
    );
    if (!env.SMTP_HOST)
      console.info(
        "Repère: configure SMTP_HOST and email delivery settings to enable email-code sign-in.",
      );
    console.info("Repère: services started; the public gateway listens on port 8080.");
    throw await supervisor.failure;
  } catch (error) {
    if (!requestedStop) throw error;
  } finally {
    const forcedExit = setTimeout(() => {
      console.error("Repère: shutdown deadline exceeded; terminating the container.");
      process.exit(1);
    }, config.shutdownMs + 1000);
    try {
      await supervisor.shutdown();
    } finally {
      clearTimeout(forcedExit);
    }
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntime().catch((error) => {
    console.error(
      `Repère: ${error instanceof RuntimeError ? error.message : "Startup failed. Check persistent volume permissions and configuration."}`,
    );
    process.exitCode = 1;
  });
}
