import { logout } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { assertSameOrigin } from "@/lib/server/security";
export async function POST(request: Request) {
  return handle(request, async () => {
    assertSameOrigin(request);
    await logout();
    return json({ ok: true });
  });
}
