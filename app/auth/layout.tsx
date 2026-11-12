import Link from "next/link";
import {
  ActivityIcon,
  BrainCircuitIcon,
  KeyRoundIcon,
  MessageSquareTextIcon,
  PlugIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";

const highlights = [
  {
    icon: BrainCircuitIcon,
    text: "Acesso a múltiplos providers de IA",
  },
  {
    icon: MessageSquareTextIcon,
    text: "Chat integrado com streaming",
  },
  {
    icon: PlugIcon,
    text: "API compatível com OpenAI",
  },
  {
    icon: KeyRoundIcon,
    text: "Gerenciamento seguro de credenciais",
  },
  {
    icon: ShieldCheckIcon,
    text: "Sessões isoladas por usuário",
  },
];

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Painel esquerdo — branding */}
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08)_0%,transparent_50%)]" />

        <div className="relative">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-semibold">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/15 backdrop-blur">
              <ActivityIcon className="size-5" />
            </div>
            ModelHub
          </Link>
        </div>

        <div className="relative flex flex-col gap-6">
          <blockquote className="max-w-md text-lg/relaxed font-medium">
            &ldquo;Todos os seus modelos de inteligência artificial em um só lugar, com uma API
            unificada e controle total.&rdquo;
          </blockquote>

          <ul className="flex flex-col gap-3">
            {highlights.map((item) => (
              <li
                key={item.text}
                className="flex items-center gap-3 text-sm text-primary-foreground/80"
              >
                <item.icon className="size-4 shrink-0" />
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/50">
          &copy; {new Date().getFullYear()} ModelHub
        </p>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 lg:justify-end">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <ActivityIcon className="size-4" />
            </div>
            ModelHub
          </Link>
          <ModeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
