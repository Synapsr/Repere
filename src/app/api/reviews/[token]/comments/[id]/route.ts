import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { updateComment } from "@/lib/server/projects";
import { assertSameOrigin } from "@/lib/server/security";
import { readJson, statusSchema } from "@/lib/server/validation";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token, id } = await context.params;
    const { status } = statusSchema.parse(await readJson(request));
    return json({ comment: await updateComment(token, id, user, status) });
  });
}
