"use client";

import { useEffect, useState } from "react";
import {
  BarChart3Icon,
  CoinsIcon,
  Loader2Icon,
  TrendingDownIcon,
  ZapIcon,
} from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, XAxis } from "recharts";
import { toast } from "sonner";

import { useAppState } from "@/components/app-state-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type { BudgetSummary, UsageSummary } from "@/lib/contracts";

function fmt(usd: number | null | undefined) {
  if (usd == null) return "—";
  if (usd < 0.001) return "< $0.001";
  return `$${usd.toFixed(4)}`;
}

function fmtPct(pct: number | null | undefined) {
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtTokens(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const BASELINE_MODELS = [
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)" },
];

export function AnalyticsSection() {
  const { providers } = useAppState();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBudget, setSavingBudget] = useState(false);

  const [limitInput, setLimitInput] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("80");
  const [blocksRequests, setBlocksRequests] = useState(false);
  const [baselineModelId, setBaselineModelId] = useState("");
  const [periodType, setPeriodType] = useState("monthly");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [usageData, budgetData] = await Promise.all([
          apiJson<UsageSummary>("/user/usage?days=30"),
          apiJson<BudgetSummary>("/user/budget"),
        ]);
        setUsage(usageData);
        setBudget(budgetData);
        setLimitInput(budgetData.limitUsd != null ? String(budgetData.limitUsd) : "");
        setAlertThreshold(String(Math.round(budgetData.alertThreshold * 100)));
        setBlocksRequests(budgetData.blocksRequests);
        setBaselineModelId(budgetData.baselineModelId ?? "");
        setPeriodType(budgetData.periodType);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar analytics.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSaveBudget() {
    setSavingBudget(true);
    try {
      const updated = await apiJsonRequest<BudgetSummary>("/user/budget", "PATCH", {
        periodType,
        limitUsd: limitInput.trim() ? Number(limitInput) : null,
        alertThreshold: Number(alertThreshold) / 100,
        blocksRequests,
        baselineModelId: baselineModelId || null,
      });
      setBudget(updated);
      toast.success("Orçamento salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar orçamento.");
    } finally {
      setSavingBudget(false);
    }
  }

  function providerLabel(providerId: string) {
    return providers.find((p) => p.id === providerId)?.label ?? providerId;
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalCost = budget?.currentSpend ?? 0;
  const savings = budget?.savings ?? null;
  const savingsPct = budget?.savingsPct ?? null;
  const totalInput = usage?.tokenStats.totalInput ?? 0;
  const totalOutput = usage?.tokenStats.totalOutput ?? 0;
  const totalRequests = usage?.totalRequests ?? 0;

  const dailyData = (usage?.daily ?? []).map((d) => ({
    date: d.date,
    custo: d.costUsd ?? 0,
    baseline: null as number | null,
  }));

  const byModel = usage?.byModel ?? [];
  const byProvider = usage?.byProvider ?? [];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardDescription>Custo total (30 dias)</CardDescription>
            <CardTitle className="text-2xl">{fmt(totalCost)}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <CoinsIcon className="size-4" />
            Período selecionado
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardDescription>Economia vs baseline</CardDescription>
            <CardTitle className="text-2xl">{savings != null ? fmt(savings) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingDownIcon className="size-4" />
            {savingsPct != null ? fmtPct(savingsPct) : "Configure baseline abaixo"}
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardDescription>Tokens totais</CardDescription>
            <CardTitle className="text-2xl">{fmtTokens(totalInput + totalOutput)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ZapIcon className="mr-1.5 inline size-4" />
            {fmtTokens(totalInput)} in · {fmtTokens(totalOutput)} out
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardDescription>Requisições</CardDescription>
            <CardTitle className="text-2xl">{totalRequests}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <BarChart3Icon className="mr-1.5 inline size-4" />
            Últimos 30 dias
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Custo diário</CardTitle>
          <CardDescription>Evolução do custo nos últimos 30 dias.</CardDescription>
        </CardHeader>
        <CardContent>
          {dailyData.length === 0 || dailyData.every((d) => d.custo === 0) ? (
            <Empty className="border-border/60">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BarChart3Icon />
                </EmptyMedia>
                <EmptyTitle>Sem custo registrado</EmptyTitle>
                <EmptyDescription>Os custos aparecerão quando houver requests com dados de tokens.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ChartContainer
              config={{
                custo: { color: "var(--color-chart-1)", label: "Custo real" },
              }}
              className="h-[260px] w-full"
            >
              <LineChart data={dailyData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) =>
                    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(v))
                  }
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line dataKey="custo" type="monotone" stroke="var(--color-custo)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Custo por modelo</CardTitle>
          </CardHeader>
          <CardContent>
            {byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado de custo por modelo ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="text-right">Req</TableHead>
                      <TableHead className="text-right">Tokens in</TableHead>
                      <TableHead className="text-right">Tokens out</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byModel.map((row) => (
                      <TableRow key={row.model ?? "unknown"}>
                        <TableCell className="text-xs">{row.model ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{row.count}</TableCell>
                        <TableCell className="text-right text-xs">{fmtTokens(row.inputTokens)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtTokens(row.outputTokens)}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(row.costUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Custo por provider</CardTitle>
          </CardHeader>
          <CardContent>
            {byProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dado de custo por provider ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Req</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">% total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byProvider.map((row) => {
                      const pct = totalCost > 0 && row.costUsd != null
                        ? ((row.costUsd / totalCost) * 100).toFixed(1)
                        : null;
                      return (
                        <TableRow key={row.provider}>
                          <TableCell className="text-xs">{providerLabel(row.provider)}</TableCell>
                          <TableCell className="text-right text-xs">{row.count}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(row.costUsd)}</TableCell>
                          <TableCell className="text-right text-xs">{pct != null ? `${pct}%` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Orçamento</CardTitle>
          <CardDescription>
            Gasto atual:{" "}
            <span className="font-medium text-foreground">{fmt(budget?.currentSpend)}</span>
            {budget?.limitUsd != null && (
              <> · Limite: <span className="font-medium text-foreground">{fmt(budget.limitUsd)}</span></>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="max-w-xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Período</FieldLabel>
                <Select value={periodType} onValueChange={setPeriodType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="daily">Diário</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Limite (USD)</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ex: 10.00"
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value)}
                />
                <FieldDescription>Deixe vazio para sem limite.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Alerta em (%)</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  placeholder="80"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                />
                <FieldDescription>Percentual do limite para alertar.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Modelo baseline</FieldLabel>
                <Select value={baselineModelId} onValueChange={setBaselineModelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="">Nenhum</SelectItem>
                      {BASELINE_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Modelo hipotético para calcular economia.</FieldDescription>
              </Field>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={blocksRequests}
                  onChange={(e) => setBlocksRequests(e.target.checked)}
                />
                Bloquear requests ao atingir limite
              </label>
            </div>
            <Button
              disabled={savingBudget}
              onClick={() => void handleSaveBudget()}
              className="w-full sm:w-auto"
            >
              {savingBudget && <Loader2Icon className="mr-2 size-3 animate-spin" />}
              Salvar orçamento
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
