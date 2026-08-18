"use client"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import type { BackstageAttempt, MessageBackstage } from "@/lib/chat-utils"
import { cn } from "@/lib/utils"

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

function formatTokens(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("pt-BR")
}

function formatCost(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return `$${value.toFixed(4)}`
}

interface MessageBackstageDialogProps {
  backstage: MessageBackstage
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Painel de inspeção por mensagem: o que realmente aconteceu para produzir a resposta
 * (roteamento, tentativas de fallback entre provedores, timing, tokens/custo).
 */
export function MessageBackstageDialog({
  backstage,
  open,
  onOpenChange,
}: MessageBackstageDialogProps) {
  const attempts = backstage.attempts ?? []
  const hasSplit =
    backstage.ttftMs !== null &&
    backstage.durationMs !== null &&
    backstage.ttftMs !== undefined &&
    backstage.durationMs !== undefined &&
    backstage.durationMs > 0
  const ttftPct = hasSplit
    ? Math.min(100, (backstage.ttftMs! / backstage.durationMs!) * 100)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bastidores da resposta</DialogTitle>
          <DialogDescription>
            O que aconteceu para gerar essa resposta: roteamento, tentativas e
            custo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{backstage.providerId}</Badge>
          {backstage.modelId ? (
            <Badge variant="outline">{backstage.modelId}</Badge>
          ) : null}
          {backstage.routingTier ? (
            <Badge variant="outline">tier: {backstage.routingTier}</Badge>
          ) : null}
          {backstage.routingReason ? (
            <Badge variant="outline">{backstage.routingReason}</Badge>
          ) : null}
        </div>

        {attempts.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Tentativas de fallback
            </p>
            <div className="flex h-6 w-full overflow-hidden rounded-md">
              {attempts.map((attempt: BackstageAttempt, index: number) => (
                <div
                  key={`${attempt.modelId}-${index}`}
                  title={`${attempt.modelId} — HTTP ${attempt.status}${attempt.errorSnippet ? `: ${attempt.errorSnippet.slice(0, 200)}` : ""}`}
                  className="flex flex-1 items-center justify-center border-r border-background bg-destructive/60 text-[10px] text-destructive-foreground last:border-r-0"
                >
                  {attempt.modelId}
                </div>
              ))}
              <div
                title={`${backstage.modelId ?? backstage.providerId} — sucesso`}
                className="flex flex-1 items-center justify-center bg-emerald-600/80 text-[10px] text-white"
              >
                {backstage.modelId ?? "sucesso"}
              </div>
            </div>
          </div>
        )}

        {hasSplit && attempts.length === 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Tempo até a resposta
            </p>
            <div
              className="flex h-6 w-full overflow-hidden rounded-md"
              title={`TTFT ${formatMs(backstage.ttftMs)} + decode ${formatMs(backstage.durationMs! - backstage.ttftMs!)}`}
            >
              <div
                className={cn(
                  "flex items-center justify-center bg-amber-500/80 text-[10px] text-white",
                )}
                style={{ width: `${ttftPct}%` }}
              >
                TTFT
              </div>
              <div className="flex flex-1 items-center justify-center bg-emerald-600/80 text-[10px] text-white">
                decode
              </div>
            </div>
          </div>
        )}

        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">
                Duração total
              </TableCell>
              <TableCell className="text-right">
                {formatMs(backstage.durationMs)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">TTFT</TableCell>
              <TableCell className="text-right">
                {formatMs(backstage.ttftMs)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">
                Tokens (entrada / saída)
              </TableCell>
              <TableCell className="text-right">
                {formatTokens(backstage.inputTokens)} /{" "}
                {formatTokens(backstage.outputTokens)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Custo</TableCell>
              <TableCell className="text-right">
                {formatCost(backstage.costUsd)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  )
}
