import { describe, expect, it } from "vitest";
import { handle } from "../../src/lib/server/errors";
import {
  projectUpdateSchema,
  requestedWorkspaceId,
  workspaceCreateSchema,
} from "../../src/lib/server/validation";
import { defaultWorkspaceName } from "../../src/lib/server/workspaces";

const workspaceId = "7443308f-2463-42c8-9478-2e766aa3605b";

describe("workspace request boundaries", () => {
  it("normalizes names and rejects empty, oversized or client-controlled membership fields", () => {
    expect(workspaceCreateSchema.parse({ name: "  Studio Écho  " })).toEqual({
      name: "Studio Écho",
    });
    expect(workspaceCreateSchema.safeParse({ name: "a".repeat(80) }).success).toBe(true);
    for (const input of [
      { name: " \n\t " },
      { name: "a".repeat(81) },
      { name: "Agency", role: "owner" },
      { name: "Agency", userId: workspaceId },
      { name: "Agency", id: workspaceId },
    ]) {
      expect(workspaceCreateSchema.safeParse(input).success).toBe(false);
    }
  });

  it("distinguishes a missing selection from a malformed or ambiguous workspace", () => {
    expect(requestedWorkspaceId({ url: "https://app.example/api/projects" })).toBeUndefined();
    expect(
      requestedWorkspaceId({ url: `https://app.example/api/projects?workspaceId=${workspaceId}` }),
    ).toBe(workspaceId);
    for (const query of [
      "workspaceId=",
      "workspaceId=all",
      "workspaceId=undefined",
      `workspaceId=${workspaceId}&workspaceId=${workspaceId}`,
      `workspaceId=${workspaceId}%20`,
    ]) {
      expect(() =>
        requestedWorkspaceId({ url: `https://app.example/api/projects?${query}` }),
      ).toThrow();
    }
  });

  it("permits an explicit project move while keeping creator and membership immutable", () => {
    expect(projectUpdateSchema.parse({ workspaceId })).toEqual({ workspaceId });
    for (const input of [
      { workspaceId: null },
      { workspaceId: "*" },
      { workspaceId, createdBy: workspaceId },
      { workspaceId, ownerId: workspaceId },
      { workspaceId, role: "owner" },
    ]) {
      expect(projectUpdateSchema.safeParse(input).success).toBe(false);
    }
  });

  it("returns stable localized validation codes without exposing submitted values", async () => {
    for (const locale of ["en", "fr"]) {
      const response = await handle(
        { headers: new Headers({ "Accept-Language": locale }) },
        async () => {
          requestedWorkspaceId({
            url: "https://app.example/api/projects?workspaceId=private-value",
          });
          return Response.json({});
        },
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("WORKSPACE_ID_INVALID");
      expect(body.error).toBe(
        locale === "fr" ? "Choisissez un espace valide." : "Choose a valid workspace.",
      );
      expect(JSON.stringify(body)).not.toContain("private-value");
    }
  });
});

describe("first workspace name", () => {
  it("uses the existing display name with a bounded fallback for legacy blank names", () => {
    expect(defaultWorkspaceName({ name: "  Studio Écho  ", email: "agency@example.com" })).toBe(
      "Studio Écho",
    );
    expect(defaultWorkspaceName({ name: " ", email: "agency@example.com" })).toBe("agency");
    expect(defaultWorkspaceName({ name: "", email: "@example.com" })).toBe("Workspace");
    expect(
      defaultWorkspaceName({ name: "a".repeat(100), email: "agency@example.com" }),
    ).toHaveLength(80);
  });
});
