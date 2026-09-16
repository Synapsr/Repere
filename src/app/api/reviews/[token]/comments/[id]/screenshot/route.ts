import { requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/errors";
import { getCommentScreenshot } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  return handle(request, async () => {
    const user = await requireUser();
    const { token, id } = await context.params;
    const file = await getCommentScreenshot(token, id, user);
    return new Response(file.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(file.size),
        "Content-Disposition": 'inline; filename="screenshot.jpg"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
