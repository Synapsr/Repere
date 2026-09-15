import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { createPreviewSession } from "@/lib/server/preview";
import { assertSameOrigin } from "@/lib/server/security";
import { resolveLocale } from "../../../../../../shared/locale";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token } = await context.params;
    return json(await createPreviewSession(token, user, resolveLocale(request.headers)));
  });
}
