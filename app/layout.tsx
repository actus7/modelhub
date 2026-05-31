import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ModelHub",
  description: "Proxy multi-provider com chat, credenciais e dashboard de uso.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Permite que o conteúdo use a área das bordas (notch / barra de gestos),
  // habilitando os insets env(safe-area-inset-*) usados no chat.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f4" },
    { media: "(prefers-color-scheme: dark)", color: "#1a2233" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontSerif.variable} ${fontMono.variable} antialiased`}
    >
      <body className="min-h-svh bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
