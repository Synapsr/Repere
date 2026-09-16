import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Project, User, WebsiteAnchor, Workspace } from "../../shared/types";

export const baseURL = () =>
  process.env.E2E_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";
export const websiteURL = () => process.env.E2E_WEBSITE_URL ?? `${baseURL()}/demo-site`;
export const identity = (label: string) => ({
  name: `Test ${label}`,
  email: `e2e-${label}-${randomUUID()}@example.test`,
});

export async function apiContext(language?: string) {
  return playwrightRequest.newContext({
    baseURL: baseURL(),
    extraHTTPHeaders: {
      Origin: new URL(baseURL()).origin,
      ...(language ? { "Accept-Language": language } : {}),
    },
  });
}

export async function emailMessage(email: string) {
  const mailpit = await playwrightRequest.newContext({
    baseURL: process.env.MAILPIT_URL ?? "http://127.0.0.1:8026",
  });
  try {
    let message: { Text: string; Subject: string } | undefined;
    await expect(async () => {
      const result = await mailpit.get("/api/v1/messages", { params: { limit: 200 } });
      expect(
        result.ok(),
        "Mailpit must be available to read real delivered OTP emails",
      ).toBeTruthy();
      const data = (await result.json()) as {
        messages: { ID: string; To: { Address: string }[] }[];
      };
      const summary = data.messages.find((message) =>
        message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
      );
      expect(summary, `Waiting for OTP email to ${email}`).toBeTruthy();
      message = (await (await mailpit.get(`/api/v1/message/${summary!.ID}`)).json()) as {
        Text: string;
        Subject: string;
      };
      expect(message.Text).toMatch(/\b\d{6}\b/);
    }).toPass({ timeout: 20_000, intervals: [200, 500, 1000] });
    return message!;
  } finally {
    await mailpit.dispose();
  }
}

export async function emailCode(email: string) {
  return (await emailMessage(email)).Text.match(/\b\d{6}\b/)![0];
}

export async function signIn(api: APIRequestContext, label: string) {
  const person = identity(label);
  const sent = await api.post("/api/auth/request", { data: person });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  const code = await emailCode(person.email);
  const verified = await api.post("/api/auth/verify", { data: { email: person.email, code } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const { user } = (await verified.json()) as { user: User };
  return { ...person, user, code };
}

export async function createWebsite(api: APIRequestContext, label: string, workspaceId?: string) {
  const route = workspaceId
    ? `/api/projects?workspaceId=${encodeURIComponent(workspaceId)}`
    : "/api/projects";
  const response = await api.post(route, {
    data: { name: `${label} ${randomUUID().slice(0, 8)}`, type: "website", url: websiteURL() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { project: Project }).project;
}

export async function listWorkspaces(api: APIRequestContext) {
  const response = await api.get("/api/workspaces");
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { workspaces: Workspace[] }).workspaces;
}

export async function createWorkspace(api: APIRequestContext, name: string) {
  const response = await api.post("/api/workspaces", { data: { name } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { workspace: Workspace }).workspace;
}

/** Workspace integration fixtures are deliberately restricted to the disposable local stack. */
export function assertLocalWorkspaceEnvironment() {
  for (const value of [baseURL(), process.env.MAILPIT_URL ?? "http://127.0.0.1:8026"]) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
      throw new Error("Workspace integration tests require local application and Mailpit hosts.");
    }
  }
}

/** Isolated permission fixture; invitation flows use the real email/acceptance API separately. */
export async function grantWorkspaceMember(workspaceId: string, userId: string) {
  assertLocalWorkspaceEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  if (
    !databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
  ) {
    throw new Error("Workspace membership fixtures require a loopback MySQL DATABASE_URL.");
  }
  const { createConnection } = await import("mysql2/promise");
  const connection = await createConnection(databaseUrl);
  try {
    const [rows] = await connection.execute("SELECT email FROM users WHERE id = ?", [userId]);
    const user = (rows as { email: string }[])[0];
    if (!user || !/^e2e-[^@]+@example\.test$/.test(user.email)) {
      throw new Error("Membership fixtures may only modify synthetic integration-test users.");
    }
    await connection.execute(
      "INSERT INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, 'member')",
      [workspaceId, userId],
    );
  } finally {
    await connection.end();
  }
  return async () => {
    const cleanup = await createConnection(databaseUrl);
    try {
      await cleanup.execute(
        "DELETE FROM workspace_members WHERE workspaceId = ? AND userId = ? AND role = 'member'",
        [workspaceId, userId],
      );
    } finally {
      await cleanup.end();
    }
  };
}

export function websiteAnchor(url = websiteURL()): WebsiteAnchor {
  return {
    type: "website",
    url,
    selector: "h1",
    text: "Atelier",
    x: 0.4,
    y: 0.6,
    documentX: 250,
    documentY: 160,
    viewportWidth: 1280,
    viewportHeight: 800,
  };
}

/** Small genuine two-page PDF, generated in memory with valid cross-reference offsets. */
export function pdfFixture(backgrounds?: [string, string]) {
  const stream = (text: string, background?: string) =>
    `${background ? `${background} rg 0 0 595 842 re f 0 0 0 rg ` : ""}BT /F1 28 Tf 55 710 Td (${text}) Tj ET`;
  const first = stream("Repere - Page 1", backgrounds?.[0]);
  const second = stream("Repere - Page 2", backgrounds?.[1]);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}\nendstream`,
    `<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}\nendstream`,
  ];
  let document = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

export async function authenticatedPage(page: Page, label: string) {
  const api = await apiContext();
  const person = await signIn(api, label);
  const state = await api.storageState();
  await page.context().addCookies(state.cookies);
  return { api, person };
}
