import { auth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

const authMiddleware = auth.middleware({
  loginUrl: "/auth/sign-in",
});

export default function proxy(request: NextRequest) {
  return authMiddleware(request);
}

export const config = {
  matcher: ["/account/:path*", "/chat", "/dashboard/:path*", "/playground", "/projects/:path*"],
};
