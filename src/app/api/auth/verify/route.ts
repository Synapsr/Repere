import { verifyOtp } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { assertSameOrigin } from "@/lib/server/security";
import { authVerifySchema, readJson } from "@/lib/server/validation";
export async function POST(request: Request) {
  return handle(request, async () => {
    assertSameOrigin(request);
    const user = await verifyOtp(request, authVerifySchema.parse(await readJson(request)));
    return json({ user });
  });
}
