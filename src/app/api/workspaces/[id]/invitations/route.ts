import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { inviteWorkspaceMember } from "@/lib/server/invitations";
import { assertSameOrigin } from "@/lib/server/security";
import { readJson, workspaceIdSchema, workspaceInvitationSchema } from "@/lib/server/validation";
import { resolveLocale } from "../../../../../../shared/locale";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const { email } = workspaceInvitationSchema.parse(await readJson(request));
    return json(
      {
        invitation: await inviteWorkspaceMember(
          workspaceIdSchema.parse(id),
          user,
          email,
          resolveLocale(request.headers),
        ),
      },
      201,
    );
  });
}
