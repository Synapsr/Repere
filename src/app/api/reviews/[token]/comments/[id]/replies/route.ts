import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { createReply } from "@/lib/server/projects";
import { assertSameOrigin } from "@/lib/server/security";
import { readJson, replySchema } from "@/lib/server/validation";
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token, id } = await context.params;
    const { body } = replySchema.parse(await readJson(request));
    return json({ reply: await createReply(token, id, user, body) }, 201);
  });
}
