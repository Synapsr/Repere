import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { removeWorkspaceMember } from "@/lib/server/invitations";
import { assertSameOrigin } from "@/lib/server/security";
import { workspaceIdSchema } from "@/lib/server/validation";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id, userId } = await context.params;
    await removeWorkspaceMember(workspaceIdSchema.parse(id), z.uuid().parse(userId), user);
    return json({ ok: true });
  });
}
