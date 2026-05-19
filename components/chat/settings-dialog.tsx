"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainIcon, Loader2Icon, SaveIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { apiJson, apiJsonRequest } from "@/lib/api";

type UserSettings = {
  customInstructionsAbout: string | null;
  customInstructionsStyle: string | null;
};

type UserMemory = {
  id: string;
  content: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [tab, setTab] = useState<"instructions" | "memory">("instructions");
  const [loading, setLoading] = useState(false);

  // Custom instructions state
  const [about, setAbout] = useState("");
  const [style, setStyle] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Memory state
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [loadingMemories, setLoadingMemories] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson<{ settings: UserSettings }>("/user/settings");
      setAbout(data.settings.customInstructionsAbout ?? "");
      setStyle(data.settings.customInstructionsStyle ?? "");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const data = await apiJson<{ memories: UserMemory[] }>("/user/memories");
      setMemories(data.memories);
    } catch {
      // silently fail
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchSettings();
      void fetchMemories();
    }
  }, [open, fetchSettings, fetchMemories]);

  async function handleSaveInstructions() {
    setSavingInstructions(true);
    try {
      await apiJsonRequest("/user/settings", "PATCH", {
        customInstructionsAbout: about.trim() || null,
        customInstructionsStyle: style.trim() || null,
      });
      toast.success("Instruções personalizadas salvas!");
    } catch {
      toast.error("Falha ao salvar instruções.");
    } finally {
      setSavingInstructions(false);
    }
  }

  async function handleAddMemory() {
    if (!newMemory.trim()) return;
    try {
      const data = await apiJsonRequest<{ memory: UserMemory }>("/user/memories", "POST", {
        content: newMemory.trim(),
      });
      setMemories((prev) => [data.memory, ...prev]);
      setNewMemory("");
      toast.success("Memória adicionada!");
    } catch {
      toast.error("Falha ao adicionar memória.");
    }
  }

  async function handleDeleteMemory(id: string) {
    try {
      await apiJsonRequest(`/user/memories/${id}`, "DELETE");
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      toast.error("Falha ao remover memória.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle>Personalizar conversa</SheetTitle>
          <SheetDescription>
            Ajuste instruções persistentes e memórias sem perder o contexto do chat.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border/60 p-4">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setTab("instructions")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "instructions" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <UserIcon className="mr-1 inline-block size-3" />
              Instruções
            </button>
            <button
              type="button"
              onClick={() => setTab("memory")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "memory" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BrainIcon className="mr-1 inline-block size-3" />
              Memória ({memories.length})
            </button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4">
            {tab === "instructions" ? (
              loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2Icon className="size-4 animate-spin" />
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium">
                      O que a IA deve saber sobre você?
                    </label>
                    <textarea
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      placeholder="Ex: Sou desenvolvedor fullstack, trabalho com TypeScript e Next.js..."
                      className="min-h-[120px] w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={2000}
                    />
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">{about.length}/2000</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium">
                      Como a IA deve responder?
                    </label>
                    <textarea
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      placeholder="Ex: Responda de forma concisa, use português brasileiro, prefira exemplos práticos..."
                      className="min-h-[120px] w-full resize-none rounded-lg border border-border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      maxLength={2000}
                    />
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">{style.length}/2000</p>
                  </div>
                </>
              )
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  Memórias são fatos que a IA lembra entre conversas. Adicione apenas o que deve persistir.
                </p>
                <div className="flex gap-2">
                  <input
                    value={newMemory}
                    onChange={(e) => setNewMemory(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddMemory();
                    }}
                    placeholder="Ex: Meu nome é João, prefiro Python..."
                    className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    maxLength={500}
                  />
                  <Button size="sm" onClick={() => void handleAddMemory()} disabled={!newMemory.trim()}>
                    Adicionar
                  </Button>
                </div>
                <ScrollArea className="max-h-[24rem]">
                  <div className="flex flex-col gap-1.5">
                    {loadingMemories ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2Icon className="size-4 animate-spin" />
                      </div>
                    ) : memories.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        Nenhuma memória salva ainda.
                      </p>
                    ) : (
                      memories.map((memory) => (
                        <div
                          key={memory.id}
                          className="group flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2"
                        >
                          <BrainIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                          <p className="min-w-0 flex-1 text-xs leading-relaxed">{memory.content}</p>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                            onClick={() => void handleDeleteMemory(memory.id)}
                            title="Remover memória"
                          >
                            <Trash2Icon className="size-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </ScrollArea>

        {tab === "instructions" ? (
          <SheetFooter className="border-t border-border/60">
            <Button onClick={() => void handleSaveInstructions()} disabled={savingInstructions || loading}>
              {savingInstructions ? <Loader2Icon className="mr-1 size-3 animate-spin" /> : <SaveIcon className="mr-1 size-3" />}
              Salvar instruções
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
