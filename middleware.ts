import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/setup", "/favicon.ico", "/favicon.svg"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith("/api"))) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(new URL("/api/setup/status", request.url), {
      method: "GET",
      headers: {
        Cookie: request.headers.get("Cookie") || "",
      },
    });
    const data = await res.json();

    if (!data.configured) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|setup|_next|favicon.ico|favicon.svg).*)"],
};