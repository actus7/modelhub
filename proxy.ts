import { auth } from "@/lib/auth/server";
import { NextResponse, type NextRequest } from "next/server";

const authMiddleware = auth.middleware({
  loginUrl: "/auth/sign-in",
});

export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/dashboard/cloud") {
    const url = request.nextUrl.clone();
    url.pathname = "/cloud";
    return NextResponse.redirect(url);
  }

  return authMiddleware(request);
}

export const config = {
  matcher: ["/account/:path*", "/chat", "/cloud", "/dashboard/:path*", "/playground", "/setup"],
};
