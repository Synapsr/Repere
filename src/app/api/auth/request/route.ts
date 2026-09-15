import { requestOtp } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/errors";
import { assertSameOrigin } from "@/lib/server/security";
import { authRequestSchema, readJson } from "@/lib/server/validation";
export async function POST(request: Request) {
  return handle(request, async () => {
    assertSameOrigin(request);
    await requestOtp(request, authRequestSchema.parse(await readJson(request)));
    return json({ ok: true });
  });
}
