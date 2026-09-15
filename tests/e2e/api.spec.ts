import { test, expect } from "@playwright/test";
import type { Feedback, Project, ReviewData } from "../../shared/types";
import {
  apiContext,
  baseURL,
  createWebsite,
  emailCode,
  emailMessage,
  identity,
  pdfFixture,
  signIn,
  websiteAnchor,
} from "./helpers";

test("locale negotiation and preference control actual OTP emails and keep error codes stable", async () => {
  const api = await apiContext("fr-CA,fr;q=0.9,en;q=0.8");
  try {
    const invalidFrench = await api.post("/api/auth/request", { data: { email: "invalid" } });
    expect(invalidFrench.status()).toBe(400);
    const frenchError = (await invalidFrench.json()) as { error: string; code: string };
    expect(frenchError.code).toBeTruthy();
    const frenchPerson = identity("locale-french");
    expect((await api.post("/api/auth/request", { data: frenchPerson })).ok()).toBeTruthy();
    const frenchEmail = await emailMessage(frenchPerson.email);
    expect(frenchEmail.Subject).toContain("Votre code Repère");
    expect(frenchEmail.Text).toContain("Ce code expire dans 10 minutes");

    const changed = await api.post("/api/locale", { data: { locale: "en" } });
    expect(changed.ok()).toBeTruthy();
    expect(await changed.json()).toEqual({ locale: "en" });
    const cookie = (await api.storageState()).cookies.find((item) => item.name === "repere_locale");
    expect(cookie).toMatchObject({ value: "en", httpOnly: true, sameSite: "Lax" });
    const englishPerson = identity("locale-english");
    expect((await api.post("/api/auth/request", { data: englishPerson })).ok()).toBeTruthy();
    const englishEmail = await emailMessage(englishPerson.email);
    expect(englishEmail.Subject).toContain("Your Repère code");
    expect(englishEmail.Text).toContain("This code expires in 10 minutes");
    const invalidEnglish = await api.post("/api/auth/request", { data: { email: "invalid" } });
    expect(invalidEnglish.status()).toBe(400);
    const englishError = (await invalidEnglish.json()) as { error: string; code: string };
    expect(englishError.code).toBe(frenchError.code);
    expect(englishError.error).not.toBe(frenchError.error);
  } finally {
    await api.dispose();
  }
});

test("email OTP verifies identity, rejects wrong/reused codes, and logout revokes the session", async () => {
  const api = await apiContext();
  try {
    expect(await (await api.get("/api/auth/me")).json()).toEqual({ user: null });
    expect((await api.get("/api/projects")).status()).toBe(401);
    const person = identity("otp");
    const sent = await api.post("/api/auth/request", { data: person });
    expect(sent.ok(), await sent.text()).toBeTruthy();
    expect(await sent.json()).not.toHaveProperty("code");
    const code = await emailCode(person.email);
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const wrong = await api.post("/api/auth/verify", {
      data: { email: person.email, code: wrongCode },
    });
    expect(wrong.status()).toBeGreaterThanOrEqual(400);
    expect(wrong.status()).toBeLessThan(500);
    const verified = await api.post("/api/auth/verify", { data: { email: person.email, code } });
    expect(verified.ok(), await verified.text()).toBeTruthy();
    expect((await verified.json()).user).toMatchObject(person);
    const cookie = (await api.storageState()).cookies.find((value) => value.httpOnly);
    expect(cookie).toBeTruthy();
    expect(cookie?.sameSite).toBe("Lax");
    const reused = await api.post("/api/auth/verify", { data: { email: person.email, code } });
    expect(reused.status()).toBeGreaterThanOrEqual(400);
    const csrf = await api.post("/api/projects", {
      headers: { Origin: "https://untrusted.example" },
      data: { name: "CSRF", type: "website", url: "https://example.com" },
    });
    expect(csrf.status()).toBe(403);
    expect((await api.post("/api/auth/logout")).ok()).toBeTruthy();
    expect(await (await api.get("/api/auth/me")).json()).toEqual({ user: null });
  } finally {
    await api.dispose();
  }
});

test("shared links preserve named comments, precise anchors, replies, ownership, and rotated access", async () => {
  const owner = await apiContext();
  const reviewer = await apiContext();
  const other = await apiContext();
  const anonymous = await apiContext();
  try {
    const ownerIdentity = await signIn(owner, "owner");
    const reviewerIdentity = await signIn(reviewer, "reviewer");
    await signIn(other, "other");
    const project = await createWebsite(owner, "Website review");
    const route = `/api/reviews/${project.shareToken}`;
    const shared = await anonymous.get(route);
    expect(shared.ok()).toBeTruthy();
    expect((await shared.json()).comments).toEqual([]);
    expect(
      (
        await anonymous.post(`${route}/comments`, {
          data: { body: "Anonymous", anchor: websiteAnchor(project.url!) },
        })
      ).status(),
    ).toBe(401);
    expect((await anonymous.post(`${route}/preview`)).status()).toBe(401);
    expect((await reviewer.get("/api/projects")).ok()).toBeTruthy();
    expect((await (await reviewer.get("/api/projects")).json()).projects).not.toContainEqual(
      expect.objectContaining({ id: project.id }),
    );
    const body = "Please increase the contrast of this heading.";
    const anchor = websiteAnchor(project.url!);
    const created = await reviewer.post(`${route}/comments`, { data: { body, anchor } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { comment } = (await created.json()) as { comment: Feedback };
    const crossOrigin = await reviewer.post(`${route}/comments`, {
      data: { body: "Wrong origin", anchor: websiteAnchor("https://unrelated.example/page") },
    });
    expect(crossOrigin.status()).toBe(400);
    expect(comment).toMatchObject({
      body,
      anchor,
      status: "open",
      kind: "text",
      number: 1,
      author: reviewerIdentity.user,
    });
    const forbidden = await other.patch(`${route}/comments/${comment.id}`, {
      data: { status: "resolved" },
    });
    expect([403, 404]).toContain(forbidden.status());
    const cannotRename = await reviewer.patch(`/api/projects/${project.id}`, {
      data: { name: "Taken over" },
    });
    expect([403, 404]).toContain(cannotRename.status());
    const reply = await owner.post(`${route}/comments/${comment.id}/replies`, {
      data: { body: "Updated the contrast, thank you." },
    });
    expect(reply.ok(), await reply.text()).toBeTruthy();
    expect((await reply.json()).reply.author).toMatchObject(ownerIdentity.user);
    expect(
      (await owner.patch(`${route}/comments/${comment.id}`, { data: { status: "resolved" } })).ok(),
    ).toBeTruthy();
    const persisted = (await (await reviewer.get(route)).json()) as ReviewData;
    expect(persisted.comments[0]).toMatchObject({
      id: comment.id,
      body,
      anchor,
      status: "resolved",
      replies: [expect.objectContaining({ body: "Updated the contrast, thank you." })],
    });
    expect(persisted.isOwner).toBe(false);
    expect((await (await owner.get(route)).json()).isOwner).toBe(true);
    const listed = (await (await owner.get("/api/projects")).json()) as { projects: Project[] };
    expect(listed.projects.find((item) => item.id === project.id)).toMatchObject({
      commentCount: 1,
      resolvedCount: 1,
    });
    const reopened = await reviewer.patch(`${route}/comments/${comment.id}`, {
      data: { status: "open" },
    });
    expect(reopened.ok()).toBeTruthy();
    const rotated = await owner.patch(`/api/projects/${project.id}`, {
      data: { rotateShareToken: true },
    });
    expect(rotated.ok(), await rotated.text()).toBeTruthy();
    const next = ((await rotated.json()) as { project: Project }).project;
    expect(next.shareToken).not.toBe(project.shareToken);
    expect((await reviewer.get(route)).status()).toBe(404);
    const afterRotation = (await (
      await reviewer.get(`/api/reviews/${next.shareToken}`)
    ).json()) as ReviewData;
    expect(afterRotation.comments[0].id).toBe(comment.id);
    const archived = await owner.patch(`/api/projects/${project.id}`, { data: { archived: true } });
    expect(archived.ok()).toBeTruthy();
    expect((await archived.json()).project.archived).toBe(true);
  } finally {
    await Promise.all([owner.dispose(), reviewer.dispose(), other.dispose(), anonymous.dispose()]);
  }
});

test("PDF upload, authenticated delivery, page anchors and validation use real persisted data", async () => {
  const owner = await apiContext();
  const anonymous = await apiContext();
  try {
    await signIn(owner, "pdf");
    const pdf = pdfFixture();
    const created = await owner.post("/api/projects", {
      multipart: {
        name: "E2E document",
        type: "pdf",
        file: { name: "review.pdf", mimeType: "application/pdf", buffer: pdf },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { project } = (await created.json()) as { project: Project };
    const route = `/api/reviews/${project.shareToken}`;
    expect(project).toMatchObject({ type: "pdf", fileName: "review.pdf" });
    expect((await anonymous.get(`${route}/file`)).status()).toBe(401);
    const download = await owner.get(`${route}/file`);
    expect(download.ok()).toBeTruthy();
    expect(download.headers()["content-type"]).toContain("application/pdf");
    expect(await download.body()).toEqual(pdf);
    const anchor = { type: "pdf", page: 2, x: 0.43, y: 0.61 };
    const comment = await owner.post(`${route}/comments`, {
      data: { body: "Change this on page two.", anchor },
    });
    expect(comment.ok(), await comment.text()).toBeTruthy();
    const stored = (await (await owner.get(route)).json()) as ReviewData;
    expect(stored.comments[0].anchor).toEqual(anchor);
    for (const invalidAnchor of [
      { ...anchor, x: 1.1 },
      { ...anchor, page: 0 },
      websiteAnchor(baseURL()),
    ]) {
      const response = await owner.post(`${route}/comments`, {
        data: { body: "Invalid anchor", anchor: invalidAnchor },
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    }
    const blank = await owner.post(`${route}/comments`, { data: { body: "   ", anchor } });
    expect(blank.status()).toBe(400);
    const invalidFile = await owner.post("/api/projects", {
      multipart: {
        name: "Spoofed PDF",
        type: "pdf",
        file: {
          name: "fake.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("<html>not a PDF</html>"),
        },
      },
    });
    expect(invalidFile.status()).toBe(400);
  } finally {
    await owner.dispose();
    await anonymous.dispose();
  }
});

test("simultaneous feedback stays numbered correctly and repeated resolution cannot corrupt counters", async () => {
  const api = await apiContext();
  try {
    await signIn(api, "concurrency");
    const project = await createWebsite(api, "Concurrent review");
    const route = `/api/reviews/${project.shareToken}`;
    const responses = await Promise.all(
      ["First", "Second", "Third"].map((body) =>
        api.post(`${route}/comments`, { data: { body, anchor: websiteAnchor(project.url!) } }),
      ),
    );
    for (const response of responses) expect(response.ok(), await response.text()).toBeTruthy();
    const comments = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { comment: Feedback }).comment),
    );
    expect(comments.map((comment) => comment.number).sort()).toEqual([1, 2, 3]);
    const resolutions = await Promise.all(
      [1, 2].map(() =>
        api.patch(`${route}/comments/${comments[0].id}`, { data: { status: "resolved" } }),
      ),
    );
    for (const response of resolutions) expect(response.ok(), await response.text()).toBeTruthy();
    const persisted = (await (await api.get(route)).json()) as ReviewData;
    expect(persisted.project).toMatchObject({ commentCount: 3, resolvedCount: 1 });
    const another = await createWebsite(api, "Separate project");
    const crossProject = await api.post(
      `/api/reviews/${another.shareToken}/comments/${comments[0].id}/replies`,
      { data: { body: "Wrong project" } },
    );
    expect(crossProject.status()).toBe(404);
    expect(
      (await api.patch(`/api/projects/${project.id}`, { data: { archived: true } })).ok(),
    ).toBeTruthy();
    const afterArchive = await api.post(`${route}/comments`, {
      data: { body: "No edits after archive", anchor: websiteAnchor(project.url!) },
    });
    expect(afterArchive.status()).toBe(409);
  } finally {
    await api.dispose();
  }
});

test("one OTP can authenticate only one of two simultaneous sessions", async () => {
  const first = await apiContext();
  const second = await apiContext();
  try {
    const person = identity("otp-race");
    expect((await first.post("/api/auth/request", { data: person })).ok()).toBeTruthy();
    const code = await emailCode(person.email);
    const responses = await Promise.all(
      [first, second].map((api) =>
        api.post("/api/auth/verify", { data: { email: person.email, code } }),
      ),
    );
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 400]);
    const sessions = await Promise.all(
      [first, second].map(async (api) => (await (await api.get("/api/auth/me")).json()).user),
    );
    expect(sessions.filter(Boolean)).toHaveLength(1);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test("five invalid OTP attempts consume the challenge even when the next code is correct", async () => {
  const api = await apiContext();
  try {
    const person = identity("otp-attempts");
    expect((await api.post("/api/auth/request", { data: person })).ok()).toBeTruthy();
    const code = await emailCode(person.email);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await api.post("/api/auth/verify", { data: { email: person.email, code: wrong } })
        ).status(),
      ).toBe(400);
    }
    expect(
      (await api.post("/api/auth/verify", { data: { email: person.email, code } })).status(),
    ).toBe(400);
    expect(await (await api.get("/api/auth/me")).json()).toEqual({ user: null });
  } finally {
    await api.dispose();
  }
});

test("native preview sessions require authentication, keep isolated origins, and reject private targets", async () => {
  const api = await apiContext();
  try {
    await signIn(api, "preview");
    const project = await createWebsite(api, "Native preview");
    const response = await api.post(`/api/reviews/${project.shareToken}/preview`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const session = (await response.json()) as {
      url: string;
      origin: string;
      targetUrl: string;
      channel: string;
      expiresAt: string;
    };
    const previewBase = new URL(process.env.PREVIEW_BASE_URL ?? "http://localhost:3001");
    const preview = new URL(session.url);
    expect(preview.hostname).toMatch(/^[a-f0-9]{48}\./);
    expect(preview.hostname.slice(49)).toBe(previewBase.hostname);
    expect(preview.port).toBe(previewBase.port);
    expect(preview.origin).toBe(session.origin);
    expect(preview.origin).not.toBe(new URL(baseURL()).origin);
    expect(session.channel).toMatch(/^[a-f0-9]{32}$/);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    const metadata = (await (
      await api.get(`/api/reviews/${project.shareToken}`)
    ).json()) as ReviewData;
    expect(metadata.project.url).toBe(session.targetUrl);
    const privateProjectResponse = await api.post("/api/projects", {
      data: {
        name: "Blocked private target",
        type: "website",
        url: "http://169.254.169.254/latest/meta-data",
      },
    });
    expect(privateProjectResponse.ok()).toBeTruthy();
    const { project: privateProject } = (await privateProjectResponse.json()) as {
      project: Project;
    };
    const blocked = await api.post(`/api/reviews/${privateProject.shareToken}/preview`);
    expect(blocked.status()).toBe(400);
  } finally {
    await api.dispose();
  }
});
