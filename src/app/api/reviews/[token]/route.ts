import { currentUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { projectByToken, projectComments, publicProject } from "@/lib/server/projects";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    const { token } = await context.params;
    const user = await currentUser();
    const project = await projectByToken(token, user);
    return json({
      project: publicProject(project),
      comments: user ? await projectComments(project.id) : [],
      user,
      isOwner: user?.id === project.ownerId,
    });
  });
}
