import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { createComment } from "@/lib/server/projects";
import { assertSameOrigin } from "@/lib/server/security";
import { commentSchema, MAX_COMMENT_BODY_BYTES, readJson } from "@/lib/server/validation";
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token } = await context.params;
    return json(
      {
        comment: await createComment(
          token,
          user,
          commentSchema.parse(await readJson(request, MAX_COMMENT_BODY_BYTES)),
        ),
      },
      201,
    );
  });
}
