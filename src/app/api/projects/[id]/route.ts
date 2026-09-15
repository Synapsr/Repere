import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { updateProject } from "@/lib/server/projects";
import { assertSameOrigin } from "@/lib/server/security";
import { projectUpdateSchema, readJson } from "@/lib/server/validation";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    return json({
      project: await updateProject(id, user, projectUpdateSchema.parse(await readJson(request))),
    });
  });
}
