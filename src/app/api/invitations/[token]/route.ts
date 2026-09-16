import { currentUser, requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { acceptInvitation, getInvitation } from "@/lib/server/invitations";
import { assertSameOrigin } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    const { token } = await context.params;
    return json(await getInvitation(token, await currentUser()));
  });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token } = await context.params;
    return json({ workspace: await acceptInvitation(token, user) });
  });
}
