import { NextRequest, NextResponse } from "next/server";

// Harmless fixture for verifying that a site's own cookies survive native preview.
// Never return cookie values or inspect the application's authentication cookie.
export function GET(request: NextRequest) {
  const response = NextResponse.json(
    { present: request.cookies.get("native_server_probe")?.value === "present" },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (request.nextUrl.searchParams.get("set") === "1") {
    response.cookies.set("native_server_probe", "present", {
      httpOnly: true,
      sameSite: "lax",
      path: "/demo-site",
      maxAge: 300,
    });
  }
  return response;
}
