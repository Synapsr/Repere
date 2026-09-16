import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { listWorkspaceMembers } from "@/lib/server/invitations";
import { workspaceIdSchema } from "@/lib/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const user = await requireUser();
    const { id } = await context.params;
    return json(await listWorkspaceMembers(workspaceIdSchema.parse(id), user));
  });
}
