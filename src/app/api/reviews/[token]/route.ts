import { currentUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { projectCoverMetadata } from "@/lib/server/covers";
import {
  canManageProject,
  projectByToken,
  projectComments,
  publicProject,
} from "@/lib/server/projects";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    const { token } = await context.params;
    const user = await currentUser();
    const project = await projectByToken(token, user);
    const canManage = await canManageProject(project, user);
    return json({
      project: publicProject(project, canManage ? await projectCoverMetadata(project.id) : null),
      comments: user ? await projectComments(project.id) : [],
      user,
      canManage,
    });
  });
}
