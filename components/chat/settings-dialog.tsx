"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainIcon, CheckIcon, Loader2Icon, PaletteIcon, PlusIcon, SaveIcon, SparklesIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { useAccent } from "@/app/accent-provider";
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
import { ACCENT_COLOR_OPTIONS, ACCENT_SWATCH, type AccentColorId } from "@/lib/accent-colors";
import { cn } from "@/lib/utils";

type UserSettings = {
  customInstructionsAbout: string | null;
  customInstructionsStyle: string | null;
  accentColor: string | null;
};

type UserMemory = {
  id: string;
  content: string;
  createdAt: string;
};

type McpServer = {
  id: string;
  name: string;
  status: string;
  url: string;
};

type HarnessSkill = {
  content: string;
  description: string | null;
  enabled: boolean;
  id: string;
  name: string;
};

type HarnessCapability = {
  available: boolean;
  description: string;
  id: string;
  reason?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [tab, setTab] = useState<"instructions" | "appearance" | "memory" | "harness">("instructions");
  const [loading, setLoading] = useState(false);

  // Custom instructions state
  const [about, setAbout] = useState("");
  const [style, setStyle] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Appearance state
  const { accent: currentAccent, setAccent } = useAccent();
  const [savingAccent, setSavingAccent] = useState(false);
  const accentSaveInFlightRef = useRef(false);

  // Memory state
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [loadingMemories, setLoadingMemories] = useState(false);

  // Harness integrations state
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<HarnessSkill[]>([]);
  const [capabilities, setCapabilities] = useState<HarnessCapability[]>([]);
  const [loadingHarness, setLoadingHarness] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");

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

  const fetchHarness = useCallback(async () => {
    setLoadingHarness(true);
    try {
      const [mcp, skillData, capabilityData] = await Promise.all([
        apiJson<{ servers: McpServer[] }>("/harness/mcp-servers"),
        apiJson<{ skills: HarnessSkill[] }>("/harness/skills"),
        apiJson<{ capabilities: HarnessCapability[] }>("/harness/capabilities"),
      ]);
      setMcpServers(mcp.servers);
      setSkills(skillData.skills);
      setCapabilities(capabilityData.capabilities);
    } catch {
      // Harness settings remain optional when the migration is not deployed yet.
    } finally {
      setLoadingHarness(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchSettings();
      void fetchMemories();
      void fetchHarness();
    }
  }, [open, fetchSettings, fetchMemories, fetchHarness]);

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

  async function handleAccentChange(next: AccentColorId) {
    if (accentSaveInFlightRef.current) return;
    const previous = currentAccent ?? "default";
    if (next === previous) return;

    accentSaveInFlightRef.current = true;
    setSavingAccent(true);
    setAccent(next);
    try {
      await apiJsonRequest("/user/settings", "PATCH", { accentColor: next });
    } catch {
      setAccent(previous);
      toast.error("Falha ao salvar a cor de destaque.");
    } finally {
      accentSaveInFlightRef.current = false;
      setSavingAccent(false);
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

  async function handleAddMcpServer() {
    if (!mcpName.trim() || !mcpUrl.trim()) return;
    let headers: Record<string, string> | undefined;
    try {
      if (mcpHeaders.trim()) {
        const parsed = JSON.parse(mcpHeaders) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Os headers devem ser um objeto JSON.");
        }
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
            if (typeof value !== "string") throw new Error("Todos os headers devem ter valor textual.");
            return [key, value];
          }),
        );
      }
      const data = await apiJsonRequest<{ server: McpServer }>("/harness/mcp-servers", "POST", {
        headers,
        name: mcpName.trim(),
        url: mcpUrl.trim(),
      });
      setMcpServers((current) => [...current, data.server].sort((a, b) => a.name.localeCompare(b.name)));
      setMcpName("");
      setMcpUrl("");
      setMcpHeaders("");
      toast.success("Servidor MCP salvo; a conexão será validada no primeiro uso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar servidor MCP.");
    }
  }

  async function handleDeleteMcpServer(id: string) {
    try {
      await apiJsonRequest(`/harness/mcp-servers/${id}`, "DELETE");
      setMcpServers((current) => current.filter((server) => server.id !== id));
    } catch {
      toast.error("Falha ao remover servidor MCP.");
    }
  }

  async function handleAddSkill() {
    if (!skillName.trim() || !skillContent.trim()) return;
    try {
      const data = await apiJsonRequest<{ skill: HarnessSkill }>("/harness/skills", "POST", {
        content: skillContent.trim(),
        name: skillName.trim(),
      });
      setSkills((current) => [data.skill, ...current]);
      setSkillName("");
      setSkillContent("");
      toast.success("Skill adicionada ao harness.");
    } catch {
      toast.error("Falha ao adicionar skill.");
    }
  }

  async function handleDeleteSkill(id: string) {
    try {
      await apiJsonRequest(`/harness/skills/${id}`, "DELETE");
      setSkills((current) => current.filter((skill) => skill.id !== id));
    } catch {
      toast.error("Falha ao remover skill.");
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
              onClick={() => setTab("appearance")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "appearance" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <PaletteIcon className="mr-1 inline-block size-3" />
              Aparência
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
            <button
              type="button"
              onClick={() => setTab("harness")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "harness" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <SparklesIcon className="mr-1 inline-block size-3" />
              Harness
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
            ) : tab === "appearance" ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-medium">Cor de destaque</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Personaliza botões, links e foco. Aplicado na hora e salvo na sua conta.
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
                  {ACCENT_COLOR_OPTIONS.map((option) => {
                    const active = (currentAccent ?? "default") === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void handleAccentChange(option.id)}
                        disabled={savingAccent}
                        aria-pressed={active}
                        aria-label={`Cor de destaque: ${option.label}`}
                        className="group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-muted"
                      >
                        <span
                          className={cn(
                            "relative flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-all",
                            active
                              ? "ring-2 ring-ring"
                              : "group-hover:ring-2 group-hover:ring-ring/60",
                          )}
                          style={{ backgroundColor: ACCENT_SWATCH[option.id] }}
                        >
                          {active ? <CheckIcon className="size-4 text-white" strokeWidth={3} /> : null}
                        </span>
                        <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : tab === "memory" ? (
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
            ) : loadingHarness ? (
              <div className="flex items-center justify-center py-8">
                <Loader2Icon className="size-4 animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <div>
                    <h3 className="text-sm font-medium">Capacidades do runtime</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Recursos indisponíveis são declarados explicitamente e nunca simulados.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {capabilities.map((capability) => (
                      <div key={capability.id} className="rounded-lg border border-border/60 bg-background p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{capability.id}</span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              capability.available
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {capability.available ? "Disponível" : "Indisponível"}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {capability.reason ?? capability.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <div>
                    <h3 className="text-sm font-medium">MCP remoto</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Conecte endpoints HTTP/SSE públicos. Headers são criptografados e não voltam para o navegador.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={mcpName}
                      onChange={(event) => setMcpName(event.target.value)}
                      placeholder="Nome do servidor"
                      maxLength={80}
                      className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      value={mcpUrl}
                      onChange={(event) => setMcpUrl(event.target.value)}
                      placeholder="https://mcp.exemplo.com"
                      type="url"
                      className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <textarea
                    value={mcpHeaders}
                    onChange={(event) => setMcpHeaders(event.target.value)}
                    placeholder={'Headers opcionais em JSON, ex.: {"Authorization":"Bearer ..."}'}
                    className="min-h-20 w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => void handleAddMcpServer()}
                      disabled={!mcpName.trim() || !mcpUrl.trim()}
                    >
                      <PlusIcon className="mr-1 size-3" />
                      Conectar MCP
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {mcpServers.length === 0 ? (
                      <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">
                        Nenhum servidor MCP conectado.
                      </p>
                    ) : (
                      mcpServers.map((server) => (
                        <div key={server.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{server.name}</p>
                            <p className="truncate text-[10px] text-muted-foreground">{server.url}</p>
                          </div>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            title="Remover servidor MCP"
                            onClick={() => void handleDeleteMcpServer(server.id)}
                          >
                            <Trash2Icon className="size-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <div>
                    <h3 className="text-sm font-medium">Skills persistentes</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Instruções especializadas carregadas no prompt do agente em todas as conversas.
                    </p>
                  </div>
                  <input
                    value={skillName}
                    onChange={(event) => setSkillName(event.target.value)}
                    placeholder="Nome da skill"
                    maxLength={100}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <textarea
                    value={skillContent}
                    onChange={(event) => setSkillContent(event.target.value)}
                    placeholder="Instruções que o agente deve seguir..."
                    maxLength={100000}
                    className="min-h-28 w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => void handleAddSkill()}
                      disabled={!skillName.trim() || !skillContent.trim()}
                    >
                      <PlusIcon className="mr-1 size-3" />
                      Adicionar skill
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {skills.length === 0 ? (
                      <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">
                        Nenhuma skill cadastrada.
                      </p>
                    ) : (
                      skills.map((skill) => (
                        <div key={skill.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
                          <SparklesIcon className="mt-0.5 size-3 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{skill.name}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                              {skill.description ?? skill.content}
                            </p>
                          </div>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            title="Remover skill"
                            onClick={() => void handleDeleteSkill(skill.id)}
                          >
                            <Trash2Icon className="size-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
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
