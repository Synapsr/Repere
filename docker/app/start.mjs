#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export class StartupError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function timeoutSetting(env, key, fallback, maximum) {
  const value = env[key] || String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1000 || Number(value) > maximum)
    throw new StartupError(`${key} must be between 1000 and ${maximum} milliseconds.`);
  return Number(value);
}
const signalExitCode = (signal) => 128 + (constants.signals[signal] ?? 1);

export async function waitForDatabase(url, { timeoutMs, signal, createConnection } = {}) {
  const connect = createConnection ?? (await import("mysql2")).createConnection;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    let connection;
    let timer;
    let abort;
    try {
      const attemptMs = Math.max(1, Math.min(2000, deadline - Date.now()));
      connection = connect({ uri: url, timezone: "Z", connectTimeout: attemptMs });
      const interrupted = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Connection deadline reached.")), attemptMs);
        abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      await Promise.race([
        connection.promise().query({ sql: "SELECT 1", timeout: attemptMs }),
        interrupted,
      ]);
      return;
    } catch {
      signal?.throwIfAborted();
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      connection?.destroy();
    }
    await sleep(Math.min(250, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  throw new StartupError(
    "MySQL did not become ready within DB_WAIT_TIMEOUT_MS. Check DATABASE_URL and network access.",
  );
}

export function runChild(script, { cwd, env, signal, timeoutMs, shutdownMs, stdio = "inherit" }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio, detached: true });
    let ended = false;
    let stopping = false;
    let timedOut = false;
    let killTimer;
    let finalTimer;
    const send = (name) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const finish = (code) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      clearTimeout(finalTimer);
      signal.removeEventListener("abort", stop);
      // A subprocess must not outlive a completed migration or application leader.
      send("SIGKILL");
      if (timedOut) reject(new StartupError("Database migration exceeded MIGRATION_TIMEOUT_MS."));
      else resolve(code);
    };
    const stop = () => {
      if (stopping || ended) return;
      stopping = true;
      send(signal.reason === "SIGINT" ? "SIGINT" : "SIGTERM");
      killTimer = setTimeout(() => send("SIGKILL"), shutdownMs);
      finalTimer = setTimeout(() => {
        // Releasing the child handles allows PID 1 to exit even if the kernel cannot reap it promptly.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(1);
      }, shutdownMs + 1000);
    };
    const deadlineTimer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, timeoutMs)
      : undefined;
    child.once("error", () => finish(1));
    child.once("exit", (code, exitSignal) => finish(code ?? signalExitCode(exitSignal)));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

export async function startApplication({
  env = process.env,
  cwd = process.cwd(),
  signalSource = process,
  waitDatabase = waitForDatabase,
  stdio = "inherit",
  log = console.info,
} = {}) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new StartupError("DATABASE_URL must be a valid MySQL connection URL.");
  }
  if (url.protocol !== "mysql:" || !url.hostname || !url.pathname.slice(1))
    throw new StartupError("DATABASE_URL must specify a MySQL host and database.");
  const dbWaitMs = timeoutSetting(env, "DB_WAIT_TIMEOUT_MS", 120000, 600000);
  const migrationMs = timeoutSetting(env, "MIGRATION_TIMEOUT_MS", 120000, 600000);
  const shutdownMs = timeoutSetting(env, "SHUTDOWN_TIMEOUT_MS", 30000, 120000);
  const controller = new AbortController();
  const term = () => controller.abort("SIGTERM");
  const interrupt = () => controller.abort("SIGINT");
  signalSource.once("SIGTERM", term);
  signalSource.once("SIGINT", interrupt);
  const options = { cwd, env, signal: controller.signal, shutdownMs, stdio };
  try {
    log("Repère: waiting for MySQL.");
    await waitDatabase(env.DATABASE_URL, { timeoutMs: dbWaitMs, signal: controller.signal });
    controller.signal.throwIfAborted();
    log("Repère: applying database migrations.");
    const code = await runChild(path.join(cwd, "migrate.mjs"), {
      ...options,
      timeoutMs: migrationMs,
    });
    controller.signal.throwIfAborted();
    if (code !== 0)
      throw new StartupError("Database migration failed. The application was not started.", code);
    log("Repère: starting Next.js.");
    return await runChild(path.join(cwd, "server.js"), options);
  } catch (error) {
    if (controller.signal.aborted) return signalExitCode(controller.signal.reason);
    throw error;
  } finally {
    signalSource.removeListener("SIGTERM", term);
    signalSource.removeListener("SIGINT", interrupt);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startApplication()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `Repère: ${error instanceof StartupError ? error.message : "Application startup failed. Check container configuration and permissions."}`,
      );
      process.exitCode = error instanceof StartupError ? error.exitCode : 1;
    });
}
