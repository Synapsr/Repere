import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { createProject, listProjects } from "@/lib/server/projects";
import { assertSameOrigin } from "@/lib/server/security";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(request, async () => json({ projects: await listProjects(await requireUser()) }));
}
export async function POST(request: Request) {
  return handle(request, async () => {
    assertSameOrigin(request);
    return json({ project: await createProject(request, await requireUser()) }, 201);
  });
}
