import { requireUser } from "@/lib/server/auth";
import { deleteProjectCover, getProjectCover, uploadProjectCover } from "@/lib/server/covers";
import { handle, json } from "@/lib/server/errors";
import { assertSameOrigin } from "@/lib/server/security";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handle(request, async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const file = await getProjectCover(id, user);
    return new Response(file.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(file.size),
        "Content-Disposition": 'inline; filename="cover.jpg"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}

export async function POST(request: Request, context: Context) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    return json({ cover: await uploadProjectCover(id, user, request) });
  });
}

export async function DELETE(request: Request, context: Context) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    return json({ cover: await deleteProjectCover(id, user) });
  });
}
