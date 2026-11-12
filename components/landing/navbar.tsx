import Link from "next/link";
import { ActivityIcon } from "lucide-react";

import { AuthButtons } from "@/components/landing/auth-buttons";
import { ModeToggle } from "@/components/mode-toggle";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ActivityIcon className="size-4" />
          </div>
          ModelHub
        </Link>

        <div className="flex items-center gap-2">
          <ModeToggle />
          <AuthButtons size="sm" />
        </div>
      </div>
    </header>
  );
}
