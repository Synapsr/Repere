import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { assertSameOrigin } from "@/lib/server/security";
import { readJson, workspaceCreateSchema } from "@/lib/server/validation";
import { createWorkspace, listWorkspaces } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async () =>
    json({ workspaces: await listWorkspaces(await requireUser()) }),
  );
}

export async function POST(request: Request) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = workspaceCreateSchema.parse(await readJson(request));
    return json({ workspace: await createWorkspace(user, input.name) }, 201);
  });
}
