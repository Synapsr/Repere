import { currentUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(request, async () => json({ user: await currentUser() }));
}
