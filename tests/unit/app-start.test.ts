import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(path.resolve("docker/app/start.mjs")).href;
const { startApplication, runChild, waitForDatabase } = await import(moduleUrl);
const directories: string[] = [];
async function fixture(migration: string, server: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), "repere-app-start-"));
  directories.push(cwd);
  await writeFile(path.join(cwd, "migrate.mjs"), migration);
  await writeFile(path.join(cwd, "server.js"), server);
  return cwd;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});
const env = { DATABASE_URL: "mysql://repere:private@db.test/repere" };

describe("standard application container startup", () => {
  it("waits for the database, applies migrations, then returns the real application's exit code", async () => {
    const cwd = await fixture(
      "import {appendFileSync} from 'node:fs'; appendFileSync('order','migrate\\n');",
      "require('node:fs').appendFileSync('order','app\\n'); process.exit(7);",
    );
    const result = await startApplication({
      env,
      cwd,
      stdio: "ignore",
      log: () => {},
      signalSource: new EventEmitter(),
      waitDatabase: async (url: string) => {
        expect(url).toBe(env.DATABASE_URL);
        await writeFile(path.join(cwd, "order"), "database\n");
      },
    });
    expect(result).toBe(7);
    expect(await readFile(path.join(cwd, "order"), "utf8")).toBe("database\nmigrate\napp\n");
  });

  it("never starts Next when the migration fails and preserves its exit status", async () => {
    const cwd = await fixture(
      "process.exit(9);",
      "require('node:fs').writeFileSync('started','yes');",
    );
    await expect(
      startApplication({
        env,
        cwd,
        stdio: "ignore",
        log: () => {},
        signalSource: new EventEmitter(),
        waitDatabase: async () => {},
      }),
    ).rejects.toMatchObject({
      message: "Database migration failed. The application was not started.",
      exitCode: 9,
    });
    await expect(readFile(path.join(cwd, "started"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["SIGTERM", "SIGINT"])(
    "forwards %s to the real child and waits for its clean exit",
    async (signal) => {
      const cwd = await fixture(
        "process.exit(0);",
        `
      const fs = require('node:fs');
      process.on(${JSON.stringify(signal)}, () => { fs.writeFileSync('received', ${JSON.stringify(signal)}); process.exit(0); });
      fs.writeFileSync('ready', 'yes'); setInterval(() => {}, 1000);
    `,
      );
      const signals = new EventEmitter();
      const running = startApplication({
        env,
        cwd,
        stdio: "ignore",
        log: () => {},
        signalSource: signals,
        waitDatabase: async () => {},
      });
      try {
        await expect
          .poll(async () => readFile(path.join(cwd, "ready"), "utf8").catch(() => ""))
          .toBe("yes");
        signals.emit(signal);
        expect(await running).toBe(0);
        expect(await readFile(path.join(cwd, "received"), "utf8")).toBe(signal);
        expect(signals.listenerCount("SIGTERM")).toBe(0);
        expect(signals.listenerCount("SIGINT")).toBe(0);
      } finally {
        signals.emit("SIGTERM");
        await running;
      }
    },
  );

  it("bounds a hung migration and terminates the whole process group", async () => {
    const cwd = await fixture("process.on('SIGTERM', () => {}); setInterval(() => {},1000);", "");
    const start = Date.now();
    await expect(
      runChild(path.join(cwd, "migrate.mjs"), {
        cwd,
        env,
        stdio: "ignore",
        signal: new AbortController().signal,
        timeoutMs: 80,
        shutdownMs: 80,
      }),
    ).rejects.toThrow("MIGRATION_TIMEOUT_MS");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("rejects invalid database configuration without revealing the connection string", async () => {
    await expect(
      startApplication({ env: { DATABASE_URL: "bad private-password" } }),
    ).rejects.toThrow("valid MySQL connection URL");
    await expect(startApplication({ env: { ...env, DB_WAIT_TIMEOUT_MS: "NaN" } })).rejects.toThrow(
      "DB_WAIT_TIMEOUT_MS",
    );
  });
});

describe("standard container database readiness", () => {
  it("bounds an unresponsive connection and destroys the socket", async () => {
    let destroyed = false;
    await expect(
      waitForDatabase(env.DATABASE_URL, {
        timeoutMs: 20,
        createConnection: () => ({
          promise: () => ({ query: () => new Promise(() => {}) }),
          destroy: () => {
            destroyed = true;
          },
        }),
      }),
    ).rejects.toThrow("DB_WAIT_TIMEOUT_MS");
    expect(destroyed).toBe(true);
  });

  it("interrupts an active readiness query on shutdown without waiting for its timeout", async () => {
    let destroyed = false;
    const controller = new AbortController();
    const waiting = waitForDatabase(env.DATABASE_URL, {
      timeoutMs: 10000,
      signal: controller.signal,
      createConnection: () => ({
        promise: () => ({ query: () => new Promise(() => {}) }),
        destroy: () => {
          destroyed = true;
        },
      }),
    });
    controller.abort("SIGTERM");
    await expect(waiting).rejects.toBe("SIGTERM");
    expect(destroyed).toBe(true);
  });
});
