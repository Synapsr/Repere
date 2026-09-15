import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

const moduleUrl = (file: string) => pathToFileURL(path.resolve("docker/all-in-one", file)).href;
const { databaseConfiguration, runtimeConfiguration, serviceEnvironments } = await import(
  moduleUrl("config.mjs")
);
const { loadOrCreateSecrets } = await import(moduleUrl("secrets.mjs"));
const { Supervisor, waitForDatabase } = await import(moduleUrl("runtime.mjs"));
const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "repere-runtime-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("all-in-one database configuration", () => {
  it("uses integrated MySQL only when no external database is configured", () => {
    expect(databaseConfiguration({})).toEqual({ mode: "local" });
    expect(
      databaseConfiguration({
        DATABASE_URL: "mysql://alice:secret@db.test/project",
        MYSQL_HOST: "ignored.test",
      }),
    ).toEqual({ mode: "external", url: "mysql://alice:secret@db.test/project" });
    for (const env of [{ MYSQL_USER: "alice" }, { MYSQL_PORT: "3307" }, { MYSQL_HOST: "db.test" }])
      expect(() => databaseConfiguration(env)).toThrow();
  });

  it("encodes every credential component without interpolation or lost characters", () => {
    const env = {
      MYSQL_HOST: "db.test",
      MYSQL_PORT: "3307",
      MYSQL_USER: "team+user@example.test",
      MYSQL_PASSWORD: "a'\"%#?@:/ +é",
      MYSQL_DATABASE: "review project",
    };
    const parsed = new URL(databaseConfiguration(env).url);
    expect(parsed.host).toBe("db.test:3307");
    expect(decodeURIComponent(parsed.username)).toBe(env.MYSQL_USER);
    expect(decodeURIComponent(parsed.password)).toBe(env.MYSQL_PASSWORD);
    expect(decodeURIComponent(parsed.pathname.slice(1))).toBe(env.MYSQL_DATABASE);
  });

  it("rejects malformed URLs, unsafe driver overrides and partial external settings without echoing secrets", () => {
    const secret = "private-password";
    for (const value of [
      `postgres://alice:${secret}@db.test/project`,
      `mysql://alice:${secret}@db.test/`,
      `mysql://alice:${secret}@db.test/project?multipleStatements=true`,
      `mysql://alice:${secret}@db.test/project?ssl=false`,
      `mysql://alice:${secret}@db.test/project?ssl=${encodeURIComponent('{"rejectUnauthorized":false}')}`,
      `mysql://alice:${secret}@db.test/project#fragment`,
    ]) {
      let message = "";
      try {
        databaseConfiguration({ DATABASE_URL: value });
      } catch (error) {
        message = String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(secret);
    }
    const url = `mysql://alice:${secret}@db.test/project?ssl=${encodeURIComponent('{"rejectUnauthorized":true}')}`;
    expect(databaseConfiguration({ DATABASE_URL: url }).url).toBe(url);
  });
});

describe("persistent generated secrets", () => {
  it("generates private, distinct credentials once and preserves them across restarts", async () => {
    const directory = await temporaryDirectory();
    const first = await loadOrCreateSecrets(directory);
    const filename = path.join(directory, "secrets.json");
    const bytes = await readFile(filename);
    expect(new Set(Object.values(first).filter((value) => typeof value === "string")).size).toBe(4);
    expect(first.mysqlPassword).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(await loadOrCreateSecrets(directory)).toEqual(first);
    expect(await readFile(filename)).toEqual(bytes);
  });

  it("publishes one complete secret set when initializers race", async () => {
    const directory = await temporaryDirectory();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => loadOrCreateSecrets(directory)),
    );
    expect(results.every((value) => JSON.stringify(value) === JSON.stringify(results[0]))).toBe(
      true,
    );
  });

  it("never invents replacement credentials for an existing or partially initialized MySQL datadir", async () => {
    const directory = await temporaryDirectory();
    await mkdir(path.join(directory, "mysql"));
    await writeFile(path.join(directory, "mysql", "ibdata1"), "existing database bytes");
    await expect(loadOrCreateSecrets(directory)).rejects.toThrow("matching secrets");
    await expect(stat(path.join(directory, "secrets.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(path.join(directory, "mysql", "ibdata1"), "utf8")).toBe(
      "existing database bytes",
    );
  });

  it("rejects corrupt or symlinked secrets instead of overwriting them", async () => {
    const directory = await temporaryDirectory();
    const filename = path.join(directory, "secrets.json");
    await writeFile(filename, "not json", { mode: 0o600 });
    await expect(loadOrCreateSecrets(directory)).rejects.toThrow("secrets file");
    expect(await readFile(filename, "utf8")).toBe("not json");
    await rm(filename);
    await writeFile(path.join(directory, "other"), "private");
    await symlink(path.join(directory, "other"), filename);
    await expect(loadOrCreateSecrets(directory)).rejects.toThrow();
    expect(await readFile(path.join(directory, "other"), "utf8")).toBe("private");
  });
});

describe("service privilege and origin boundaries", () => {
  it("provides separate internal listeners and only each service's necessary credentials", async () => {
    const secrets = await loadOrCreateSecrets(await temporaryDirectory());
    const env = {
      SMTP_PASSWORD: "mail-private",
      MYSQL_RANDOM_ROOT_PASSWORD: "yes",
      MYSQL_ALLOW_EMPTY_PASSWORD: "yes",
      NODE_OPTIONS: "--inspect=0.0.0.0",
    };
    const config = runtimeConfiguration(env);
    const services = serviceEnvironments(env, config, secrets);
    expect(config.appUrl).toBe("http://localhost:8080");
    expect(config.previewBaseUrl).toBe("http://localhost:8080");
    expect(services.app).toMatchObject({
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
      UPLOAD_DIR: "/data/uploads",
    });
    expect(services.preview).toMatchObject({ PORT: "3001", PREVIEW_BIND_HOST: "127.0.0.1" });
    expect(services.gateway.PORT).toBe("8080");
    for (const name of ["preview", "gateway", "mysql", "migration"])
      expect(services[name].SMTP_PASSWORD).toBeUndefined();
    for (const name of ["preview", "gateway", "mysql"])
      expect(services[name].DATABASE_URL).toBeUndefined();
    for (const name of ["app", "preview", "gateway", "migration"])
      expect(services[name].MYSQL_ROOT_PASSWORD).toBeUndefined();
    expect(services.mysql.MYSQL_ROOT_HOST).toBe("localhost");
    expect(services.mysql.MYSQL_RANDOM_ROOT_PASSWORD).toBeUndefined();
    expect(services.mysql.MYSQL_ALLOW_EMPTY_PASSWORD).toBeUndefined();
    expect(services.app.NODE_OPTIONS).toBeUndefined();
  });

  it("requires explicit HTTPS preview configuration remotely and accepts an isolated wildcard parent", () => {
    expect(() => runtimeConfiguration({ APP_URL: "http://app.test" })).toThrow("HTTPS");
    expect(() => runtimeConfiguration({ APP_URL: "https://app.test" })).toThrow("PREVIEW_BASE_URL");
    expect(
      runtimeConfiguration({
        APP_URL: "https://app.repere.dev",
        PREVIEW_BASE_URL: "https://repere.dev",
      }),
    ).toMatchObject({
      appUrl: "https://app.repere.dev",
      previewBaseUrl: "https://repere.dev",
      local: false,
    });
  });
});

describe("bounded readiness and process supervision", () => {
  it("queries the configured database and closes every readiness connection", async () => {
    let attempts = 0;
    let destroyed = false;
    await waitForDatabase("mysql://user:private@db.test/repere", {
      timeoutMs: 1500,
      connect: async () => {
        attempts++;
        if (attempts === 1) throw new Error("private driver failure");
        return {
          query: async ({ sql }: { sql: string }) => expect(sql).toBe("SELECT 1"),
          destroy: () => {
            destroyed = true;
          },
        };
      },
    });
    expect(attempts).toBe(2);
    expect(destroyed).toBe(true);
  });

  it("times out with a sanitized error and aborts readiness promptly", async () => {
    const connect = async () => {
      throw new Error("private-password");
    };
    await expect(
      waitForDatabase("mysql://user:private-password@db.test/repere", { timeoutMs: 20, connect }),
    ).rejects.toThrow("DB_WAIT_TIMEOUT_MS");
    const controller = new AbortController();
    controller.abort(new Error("stop requested"));
    await expect(waitForDatabase("unused", { signal: controller.signal, connect })).rejects.toThrow(
      "stop requested",
    );
  });

  it("fails fast on a real essential child exit, including a successful but unexpected exit", async () => {
    const supervisor = new Supervisor({ shutdownMs: 300, stdio: "ignore" });
    try {
      supervisor.start("preview", process.execPath, ["-e", "process.exit(0)"]);
      await expect(supervisor.failure).resolves.toMatchObject({
        message: "preview stopped unexpectedly. The container will restart all services.",
      });
      expect(supervisor.controller.signal.aborted).toBe(true);
    } finally {
      await supervisor.shutdown();
    }
  });

  it("allows a successful migration before starting services and escalates a stuck process group", async () => {
    const supervisor = new Supervisor({ shutdownMs: 150, stdio: "pipe" });
    try {
      const migration = supervisor.start("migration", process.execPath, ["-e", "process.exit(0)"], {
        essential: false,
      });
      expect(await migration.done).toBe(0);
      expect(supervisor.controller.signal.aborted).toBe(false);
      const child = supervisor.start("application", process.execPath, [
        "-e",
        "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)",
      ]);
      await once(child.child.stdout, "data");
      const start = Date.now();
      await supervisor.shutdown();
      expect(Date.now() - start).toBeLessThan(2000);
      expect(child.exited).toBe(true);
      expect(child.child.signalCode).toBe("SIGKILL");
    } finally {
      await supervisor.shutdown();
    }
  });
});
