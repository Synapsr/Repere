import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

async function main() {
  // Always use a disposable container: this command never reads DATABASE_URL or .env.
  const exec = promisify(execFile);
  const container = `repere-migration-test-${randomUUID()}`;
  const password = randomBytes(32).toString("hex");
  const temporary = await mkdtemp(path.join(tmpdir(), "repere-migrations-"));
  let connection: Connection | undefined;
  let started = false;

  async function rows(sql: string) {
    const [result] = await connection!.query<RowDataPacket[]>(sql);
    return result.map((row) => ({ ...row }));
  }

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
        timeout: 180_000,
      },
    );
    started = true;
    const { stdout } = await exec("docker", ["port", container, "3306/tcp"]);
    const port = Number(stdout.trim().split(":").at(-1));
    const deadline = Date.now() + 120_000;
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
    await connection.query("CREATE DATABASE upgrade_fixture");
    await connection.query("USE upgrade_fixture");

    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const initial = journal.entries[0];
    await mkdir(path.join(temporary, "meta"));
    await writeFile(
      path.join(temporary, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: [initial] }),
    );
    await writeFile(
      path.join(temporary, `${initial.tag}.sql`),
      await readFile(`drizzle/${initial.tag}.sql`),
    );
    await migrate(drizzle({ client: connection }), { migrationsFolder: temporary });

    const [owner, secondOwner, guest, website, pdf, comment, reply, attachment] = Array.from(
      { length: 8 },
      () => randomUUID(),
    );
    await connection.query("INSERT INTO users (id,email,name) VALUES (?,?,?),(?,?,?),(?,?,?)", [
      owner,
      "owner@example.test",
      "Studio Alpha",
      secondOwner,
      "owner2@example.test",
      "Studio Beta",
      guest,
      "guest@example.test",
      "Reviewer",
    ]);
    await connection.query(
      "INSERT INTO projects (id,ownerId,name,type,url,shareToken,nextCommentNumber,commentCount,resolvedCount) VALUES (?,?,?,'website',?,?,2,1,1)",
      [
        website,
        owner,
        "Website with feedback",
        "https://example.com",
        randomBytes(32).toString("base64url"),
      ],
    );
    await connection.query(
      "INSERT INTO projects (id,ownerId,name,type,fileName,storageKey,fileSize,shareToken,archived) VALUES (?,?,?,'pdf',?,?,?, ?,true)",
      [
        pdf,
        secondOwner,
        "Archived PDF",
        "document.pdf",
        `${randomUUID()}.pdf`,
        1024,
        randomBytes(32).toString("base64url"),
      ],
    );
    await connection.query(
      "INSERT INTO comments (id,projectId,authorId,number,body,status,anchor) VALUES (?,?,?,1,?,'resolved',?)",
      [
        comment,
        website,
        guest,
        "Keep this feedback",
        JSON.stringify({
          type: "website",
          url: "https://example.com/about",
          selector: "h1",
          text: "Heading",
          x: 0.5,
          y: 0.5,
          documentX: 100,
          documentY: 200,
          viewportWidth: 1280,
          viewportHeight: 800,
        }),
      ],
    );
    await connection.query("INSERT INTO replies (id,commentId,authorId,body) VALUES (?,?,?,?)", [
      reply,
      comment,
      owner,
      "Keep this reply",
    ]);
    await connection.query(
      "INSERT INTO attachments (id,commentId,storageKey,mimeType,fileName,byteSize) VALUES (?,?,?,?,?,?)",
      [attachment, comment, "reserved-audio", "audio/webm", "note.webm", 42],
    );
    await connection.query(
      "INSERT INTO sessions (tokenHash,userId,expiresAt) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [randomBytes(32).toString("hex"), owner],
    );

    const tables = ["users", "comments", "replies", "attachments", "sessions"];
    const before = new Map<string, RowDataPacket[]>();
    for (const table of tables) before.set(table, await rows(`SELECT * FROM ${table}`));
    const projectBefore = await rows("SELECT * FROM projects ORDER BY id");
    const workspaceSql = (await readFile("drizzle/0001_workspaces.sql", "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    // MySQL commits DDL before Drizzle records migration completion. Simulate a
    // stopped startup after the backfill, then let the regular migrator resume.
    const interruptedAt = workspaceSql.findIndex((statement) =>
      statement.includes("MODIFY `workspaceId`"),
    );
    assert.ok(interruptedAt > 0);
    for (const statement of workspaceSql.slice(0, interruptedAt + 1))
      await connection.query(statement);
    // Stop at the released 0.2.0 schema before exercising the invitation upgrade.
    await writeFile(
      path.join(temporary, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    );
    await writeFile(
      path.join(temporary, `${journal.entries[1].tag}.sql`),
      await readFile(`drizzle/${journal.entries[1].tag}.sql`),
    );
    await migrate(drizzle({ client: connection }), { migrationsFolder: temporary });
    for (const table of tables)
      assert.deepEqual(
        await rows(`SELECT * FROM ${table}`),
        before.get(table),
        `${table} must survive the upgrade unchanged`,
      );
    const projectAfter = await rows("SELECT * FROM projects ORDER BY id");
    assert.equal(projectAfter.length, projectBefore.length);
    for (let i = 0; i < projectBefore.length; i++) {
      const { ownerId, ...existing } = projectBefore[i];
      const { workspaceId, createdBy, ...preserved } = projectAfter[i];
      assert.deepEqual(
        preserved,
        existing,
        "Project IDs, links, counters, timestamps and PDF metadata must be preserved",
      );
      if (createdBy !== undefined) assert.equal(createdBy, ownerId);
      const membership: RowDataPacket[] = (
        await connection.query<RowDataPacket[]>(
          "SELECT role FROM workspace_members WHERE workspaceId=? AND userId=?",
          [workspaceId, ownerId],
        )
      )[0];
      assert.equal(membership[0]?.role, "owner");
    }
    const workspaces = await rows("SELECT * FROM workspaces ORDER BY id");
    const memberships = await rows("SELECT * FROM workspace_members ORDER BY workspaceId,userId");
    // Also cover a stop after the final DDL but before the migration journal write.
    for (const statement of workspaceSql) await connection.query(statement);
    await migrate(drizzle({ client: connection }), { migrationsFolder: temporary });
    assert.deepEqual(
      await rows("SELECT * FROM workspaces ORDER BY id"),
      workspaces,
      "Restart must not duplicate workspaces",
    );
    assert.deepEqual(
      await rows("SELECT * FROM workspace_members ORDER BY workspaceId,userId"),
      memberships,
    );
    assert.deepEqual(await rows("SELECT * FROM projects ORDER BY id"), projectAfter);
    console.info(
      "PASS: upgrade from 0.1.1 preserves projects, review links, PDFs, feedback and sessions; interrupted upgrade resumes and rerun is stable.",
    );

    await connection.query(
      "INSERT INTO workspace_members (workspaceId,userId,role) VALUES (?,?,'member')",
      [owner, guest],
    );
    const existingTables = [...tables, "projects", "workspaces", "workspace_members"];
    const beforeInvitations = new Map<string, RowDataPacket[]>();
    for (const table of existingTables)
      beforeInvitations.set(table, await rows(`SELECT * FROM ${table}`));
    const invitationMigration = journal.entries[2];
    assert.ok(invitationMigration, "Invitation migration must be registered");
    const invitationSql = (await readFile(`drizzle/${invitationMigration.tag}.sql`, "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    // Resume after MySQL commits the invitation DDL but before Drizzle journals it.
    for (const statement of invitationSql) await connection.query(statement);
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    for (const table of existingTables)
      assert.deepEqual(
        await rows(`SELECT * FROM ${table}`),
        beforeInvitations.get(table),
        `${table} must survive the 0.2.0 invitation upgrade unchanged`,
      );
    await connection.query(
      "INSERT INTO workspace_invitations (id,workspaceId,email,inviterId,tokenHash,expiresAt) VALUES (?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [randomUUID(), owner, "invitee@example.test", owner, randomBytes(32).toString("hex")],
    );
    const invitations = await rows("SELECT * FROM workspace_invitations");
    for (const statement of invitationSql) await connection.query(statement);
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    assert.deepEqual(await rows("SELECT * FROM workspace_invitations"), invitations);
    console.info(
      "PASS: upgrade from 0.2.0 preserves workspaces, members and all existing data; interrupted invitation migration resumes without losing invitations.",
    );

    await connection.query("CREATE DATABASE fresh_fixture");
    await connection.end();
    connection = await mysql.createConnection({
      host: "127.0.0.1",
      port,
      user: "root",
      password,
      database: "fresh_fixture",
      timezone: "Z",
    });
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    const tableNames = (await rows("SHOW TABLES")).map((row) => Object.values(row)[0]);
    for (const table of [
      "workspaces",
      "workspace_members",
      "workspace_invitations",
      "projects",
      ...tables,
    ])
      assert.ok(tableNames.includes(table), `Fresh installation must include ${table}`);
    const columns = await rows("SHOW COLUMNS FROM projects");
    assert.ok(columns.some((column) => column.Field === "workspaceId" && column.Null === "NO"));
    assert.ok(!columns.some((column) => column.Field === "ownerId"));
    assert.equal((await rows("SELECT * FROM workspaces")).length, 0);
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    console.info(
      "PASS: fresh MySQL installation and repeat startup apply all migrations successfully.",
    );
  } catch (error) {
    // Driver errors can contain connection details; report only an assertion or a safe identifier.
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Migration verification failed; inspect the local migration and Docker availability.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.end();
    if (started) await exec("docker", ["rm", "--force", "--volumes", container]);
    await rm(temporary, { recursive: true, force: true });
  }
}

void main().catch(() => {
  console.error("Could not prepare or clean up the disposable migration test.");
  process.exitCode = 1;
});
