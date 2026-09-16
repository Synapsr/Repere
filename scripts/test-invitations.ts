import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql, { type Connection } from "mysql2/promise";

async function main() {
  // No dotenv or user DATABASE_URL: the suite can only reach its disposable local container.
  const exec = promisify(execFile);
  const container = `repere-invitation-test-${randomUUID()}`;
  const database = `repere_invitation_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  let connection: Connection | undefined;
  let started = false;
  try {
    await exec(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        container,
        "--publish",
        "127.0.0.1::3306",
        "--env",
        "MYSQL_ROOT_PASSWORD",
        "--env",
        "MYSQL_ROOT_HOST=%",
        "mysql:8.4",
      ],
      {
        env: { ...process.env, MYSQL_ROOT_PASSWORD: password },
        timeout: 180000,
      },
    );
    started = true;
    const { stdout } = await exec("docker", ["port", container, "3306/tcp"]);
    const port = Number(stdout.trim().split(":").at(-1));
    const deadline = Date.now() + 120000;
    while (!connection && Date.now() < deadline) {
      try {
        connection = await mysql.createConnection({
          host: "127.0.0.1",
          port,
          user: "root",
          password,
          timezone: "Z",
          connectTimeout: 1500,
        });
      } catch {
        await delay(1000);
      }
    }
    assert.ok(connection, "Disposable MySQL must start within two minutes");
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`CREATE DATABASE ${database}`);
    await connection.query(`USE ${database}`);
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.invitations.config.mts"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: "",
            INVITATION_TEST_DATABASE_URL: `mysql://root:${password}@127.0.0.1:${port}/${database}`,
          },
        },
      );
      const timeout = setTimeout(() => child.kill("SIGKILL"), 120000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });
    });
    process.exitCode = code;
  } catch (error) {
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Invitation verification failed; check Docker and the local test suite.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.end();
    if (started) await exec("docker", ["rm", "--force", "--volumes", container]);
  }
}

void main().catch(() => {
  console.error("Could not prepare or clean up the disposable invitation test.");
  process.exitCode = 1;
});
