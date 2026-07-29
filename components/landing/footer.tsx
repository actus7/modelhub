import { ActivityIcon } from "lucide-react";

import { Separator } from "@/components/ui/separator";

export function Footer() {
  return (
    <footer className="px-6 pb-8">
      <div className="mx-auto max-w-6xl">
        <Separator className="mb-8" />
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ActivityIcon className="size-4" />
            </div>
            ModelHub
          </div>
          <iframe
            src="https://github.com/sponsors/actus7/button"
            title="Sponsor actus7"
            height={32}
            width={114}
            className="rounded-md border-0"
          />
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} ModelHub. Projeto open-source.
          </p>
        </div>
      </div>
    </footer>
  );
}

