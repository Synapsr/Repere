import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Feedback, Project } from "../../shared/types";
import {
  apiContext,
  assertLocalWorkspaceEnvironment,
  createWebsite,
  createWorkspace,
  grantWorkspaceMember,
  pdfFixture,
  signIn,
  websiteAnchor,
} from "./helpers";

test("prompt export requires workspace membership and selects only current open feedback", async () => {
  assertLocalWorkspaceEnvironment();
  const owner = await apiContext("fr");
  const participant = await apiContext("en");
  const anonymous = await apiContext();
  let removeMember: (() => Promise<void>) | undefined;
  try {
    await signIn(owner, "prompt-owner");
    const invited = await signIn(participant, "prompt-participant");
    const project = await createWebsite(owner, "Prompt project");
    const endpoint = `/api/projects/${project.id}/prompt`;
    expect((await anonymous.get(endpoint)).status()).toBe(401);
    expect((await participant.get(`/api/reviews/${project.shareToken}`)).status()).toBe(200);
    expect((await participant.get(endpoint)).status()).toBe(404);
    const empty = await owner.get(endpoint);
    expect(empty.status()).toBe(409);
    expect((await empty.json()).code).toBe("PROMPT_EMPTY");
    const saved: Feedback[] = [];
    for (const body of ["First open request", "Already completed request", "Second open request"]) {
      const response = await owner.post(`/api/reviews/${project.shareToken}/comments`, {
        data: { body, anchor: websiteAnchor(project.url!) },
      });
      expect(response.status()).toBe(201);
      saved.push((await response.json()).comment);
    }
    await owner.patch(`/api/reviews/${project.shareToken}/comments/${saved[1].id}`, {
      data: { status: "resolved" },
    });
    await participant.post(`/api/reviews/${project.shareToken}/comments/${saved[0].id}/replies`, {
      data: { body: "Please keep the current label." },
    });
    const response = await owner.get(endpoint);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["content-language"]).toBe("fr");
    const all = await response.json();
    expect(all.count).toBe(2);
    for (const included of [
      "Applique les retours",
      "First open request",
      "Second open request",
      "Please keep the current label.",
    ])
      expect(all.prompt).toContain(included);
    for (const excluded of ["Already completed request", project.shareToken, invited.email])
      expect(all.prompt).not.toContain(excluded);
    const single = await owner.get(endpoint, { params: { commentId: saved[0].id } });
    expect((await single.json()).prompt).not.toContain("Second open request");
    expect((await owner.get(endpoint, { params: { commentId: saved[1].id } })).status()).toBe(409);
    for (const query of [
      "commentId=bad",
      `commentId=${saved[0].id}&commentId=${saved[2].id}`,
      "status=resolved",
    ])
      expect((await owner.get(`${endpoint}?${query}`)).status()).toBe(400);
    expect((await owner.get(endpoint, { params: { commentId: randomUUID() } })).status()).toBe(404);
    const other = await createWebsite(owner, "Other prompt project");
    expect(
      (await owner.get(`/api/projects/${other.id}/prompt?commentId=${saved[0].id}`)).status(),
    ).toBe(404);
    removeMember = await grantWorkspaceMember(project.workspaceId, invited.user.id);
    const memberResult = await participant.get(endpoint);
    expect(memberResult.status()).toBe(200);
    expect((await memberResult.json()).prompt).toContain("Implement the following feedback");
    const destination = await createWorkspace(owner, "Prompt destination");
    expect(
      (
        await owner.patch(`/api/projects/${project.id}`, { data: { workspaceId: destination.id } })
      ).status(),
    ).toBe(200);
    expect((await participant.get(endpoint)).status()).toBe(404);
    expect((await owner.get(endpoint)).status()).toBe(200);
    expect(
      (
        await owner.patch(`/api/projects/${project.id}`, {
          data: { workspaceId: project.workspaceId },
        })
      ).status(),
    ).toBe(200);
    expect((await participant.get(endpoint)).status()).toBe(200);
    await removeMember();
    removeMember = undefined;
    expect((await participant.get(endpoint)).status()).toBe(404);
    expect((await participant.get(`/api/reviews/${project.shareToken}`)).status()).toBe(200);
    await owner.patch(`/api/projects/${project.id}`, { data: { archived: true } });
    expect((await owner.get(endpoint)).status()).toBe(200);
    expect((await participant.get(endpoint)).status()).toBe(404);
    const upload = await owner.post("/api/projects", {
      multipart: {
        name: "PDF prompt",
        type: "pdf",
        file: { name: "document.pdf", mimeType: "application/pdf", buffer: pdfFixture() },
      },
    });
    expect(upload.status()).toBe(201);
    const pdf: Project = (await upload.json()).project;
    await owner.post(`/api/reviews/${pdf.shareToken}/comments`, {
      data: { body: "Change page two", anchor: { type: "pdf", page: 2, x: 0.3, y: 0.4 } },
    });
    const pdfExport = await owner.get(`/api/projects/${pdf.id}/prompt`);
    expect(pdfExport.status()).toBe(200);
    expect((await pdfExport.json()).prompt).toContain("Page : 2");
  } finally {
    await removeMember?.();
    await Promise.all([owner.dispose(), participant.dispose(), anonymous.dispose()]);
  }
});
