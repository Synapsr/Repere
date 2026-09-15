import { requireUser } from "@/lib/server/auth";
import { ApiError, handle } from "@/lib/server/errors";
import { projectByToken } from "@/lib/server/projects";
import { readPdf } from "@/lib/server/uploads";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(request, async () => {
    const user = await requireUser();
    const { token } = await context.params;
    const project = await projectByToken(token, user);
    if (project.type !== "pdf" || !project.storageKey) throw new ApiError(404, "PDF_NOT_FOUND");
    const file = await readPdf(project.storageKey);
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(file.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(project.fileName || "document.pdf")}`,
      },
    });
  });
}
