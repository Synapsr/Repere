import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { revokeWorkspaceInvitation } from "@/lib/server/invitations";
import { assertSameOrigin } from "@/lib/server/security";
import { workspaceIdSchema } from "@/lib/server/validation";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; invitationId: string }> },
) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id, invitationId } = await context.params;
    await revokeWorkspaceInvitation(
      workspaceIdSchema.parse(id),
      z.uuid().parse(invitationId),
      user,
    );
    return json({ ok: true });
  });
}
