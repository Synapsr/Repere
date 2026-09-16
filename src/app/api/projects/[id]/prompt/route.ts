import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { ApiError, handle, json } from "@/lib/server/errors";
import { getProjectPrompt } from "@/lib/server/projects";
import { resolveLocale } from "../../../../../../shared/locale";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((key) => key !== "commentId") ||
      query.getAll("commentId").length > 1
    )
      throw new ApiError(400, "INVALID_INPUT");
    const commentId = query.has("commentId") ? z.uuid().parse(query.get("commentId")) : undefined;
    const locale = resolveLocale(request.headers);
    return json(await getProjectPrompt(z.uuid().parse(id), user, locale, commentId), 200, locale);
  });
}
