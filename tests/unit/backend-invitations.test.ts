import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceInvitationSchema } from "../../src/lib/server/validation";
import { renderInvitationEmail } from "../../src/lib/server/emails";
import {
  deliverInvitation,
  invitationEmailHint,
  invitationSendInProgress,
  invitationUnavailable,
  INVITATION_SEND_LEASE_MS,
  INVITATION_TTL_MS,
  publicInvitation,
} from "../../src/lib/server/invitations";
import { randomToken, tokenHash } from "../../src/lib/server/security";

afterEach(() => vi.restoreAllMocks());

describe("workspace invitation boundaries", () => {
  it("normalizes recipients and rejects role, token and membership injection", () => {
    expect(workspaceInvitationSchema.parse({ email: "  Alice@EXAMPLE.test " })).toEqual({
      email: "alice@example.test",
    });
    for (const input of [
      { email: "bad" },
      { email: "alice@example.test", role: "owner" },
      { email: "alice@example.test", token: randomToken() },
      { email: "alice@example.test", userId: "another-user" },
    ])
      expect(workspaceInvitationSchema.safeParse(input).success).toBe(false);
  });

  it("masks the recipient and exposes no token material in owner DTOs", () => {
    const email = "alice@example.test";
    expect(invitationEmailHint(email)).toBe("a•••@example.test");
    expect(invitationEmailHint("a@example.test")).not.toContain("a@example.test");
    const rawToken = randomToken();
    const row = {
      id: "invitation-id",
      workspaceId: "workspace-id",
      email,
      inviterId: "user-id",
      tokenHash: tokenHash(rawToken),
      pendingTokenHash: tokenHash(randomToken()),
      pendingStartedAt: null,
      createdAt: new Date("2026-09-16T00:00:00Z"),
      updatedAt: new Date("2026-09-16T00:00:00Z"),
      expiresAt: new Date("2026-09-23T00:00:00Z"),
      acceptedAt: null,
      revokedAt: null,
    };
    expect(publicInvitation(row)).toEqual({
      id: row.id,
      email,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
    expect(JSON.stringify(publicInvitation(row))).not.toContain(rawToken);
    expect(JSON.stringify(publicInvitation(row))).not.toContain(row.tokenHash);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("expires at the exact boundary and always rejects revocation", () => {
    const now = new Date("2026-09-16T00:00:00Z");
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(
      invitationUnavailable({ expiresAt: new Date(now.getTime() + 1), revokedAt: null }, now),
    ).toBe(false);
    expect(invitationUnavailable({ expiresAt: now, revokedAt: null }, now)).toBe(true);
    expect(
      invitationUnavailable(
        { expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), revokedAt: now },
        now,
      ),
    ).toBe(true);
  });

  it("allows recovery from a crashed sender only after the bounded lease", () => {
    const started = new Date("2026-09-16T00:00:00Z");
    const row = { pendingTokenHash: tokenHash(randomToken()), pendingStartedAt: started };
    expect(
      invitationSendInProgress(row, new Date(started.getTime() + INVITATION_SEND_LEASE_MS - 1)),
    ).toBe(true);
    expect(
      invitationSendInProgress(row, new Date(started.getTime() + INVITATION_SEND_LEASE_MS)),
    ).toBe(false);
    expect(invitationSendInProgress({ ...row, pendingTokenHash: null }, started)).toBe(false);
  });
});

describe("invitation email and delivery sequencing", () => {
  it("escapes workspace and inviter content, preserves the local language and links only to acceptance", () => {
    const token = randomToken();
    const url = `https://app.example/invite/${token}`;
    for (const locale of ["en", "fr"] as const) {
      const email = renderInvitationEmail(locale, {
        workspaceName: "<img src=x>\r\nInjected",
        inviterName: "<script>alert(1)</script>",
        url,
      });
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.html).toContain(`href="${url}"`);
      expect(email.html).toContain("&lt;img src=x&gt;");
      expect(email.html).not.toContain("<script>");
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.text).toContain(url);
      expect(email.text).toContain(locale === "fr" ? "7 jours" : "7 days");
    }
    for (const url of [
      "javascript:alert(1)",
      "https://user:pass@example.test/invite/invalid",
      "https://app.example/elsewhere",
    ]) {
      expect(() =>
        renderInvitationEmail("en", { workspaceName: "Team", inviterName: "Owner", url }),
      ).toThrow();
    }
  });

  it("discards an undelivered candidate and never activates it or exposes SMTP details", async () => {
    const activate = vi.fn();
    const discard = vi.fn(async () => undefined);
    await expect(
      deliverInvitation(
        async () => {
          throw new Error("private SMTP detail");
        },
        activate,
        discard,
      ),
    ).rejects.toMatchObject({ status: 503, code: "EMAIL_DELIVERY_FAILED" });
    expect(discard).toHaveBeenCalledExactlyOnceWith();
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates only after delivery and preserves cancellation or CAS errors after successful SMTP", async () => {
    const order: string[] = [];
    const discard = vi.fn(async () => undefined);
    const result = await deliverInvitation(
      async () => {
        order.push("send");
      },
      async () => {
        order.push("activate");
        return "active";
      },
      discard,
    );
    expect(result).toBe("active");
    expect(order).toEqual(["send", "activate"]);
    const cancellation = new Error("Concurrent cancellation");
    await expect(
      deliverInvitation(
        async () => undefined,
        async () => {
          throw cancellation;
        },
        discard,
      ),
    ).rejects.toBe(cancellation);
    expect(discard).not.toHaveBeenCalled();
  });
});
