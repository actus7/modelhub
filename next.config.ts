import type { NextConfig } from "next";

/**
 * Headers de segurança das páginas. As rotas da API (Hono) definem os seus em
 * `server/lib/security.ts`. HSTS fica a cargo da Vercel. Sem CSP por enquanto:
 * o preview de canvas compila código do usuário em iframes sandboxed e exige
 * uma política desenhada com cuidado.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
