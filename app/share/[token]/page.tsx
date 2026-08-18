"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BotIcon, Loader2Icon, UserIcon } from "lucide-react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { CanvasPreview } from "@/components/canvas/canvas-preview";
import type { CanvasKind } from "@/lib/contracts";

type SharedMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type SharedConversation = {
  id: string;
  title: string;
  createdAt: string;
  messages: SharedMessage[];
};

type SharedCanvas = {
  title: string;
  kind: CanvasKind;
  language: string | null;
  content: string;
  createdAt: string;
};

type SharedArtifact = {
  title: string;
  kind: CanvasKind;
  language: string | null;
  content: string;
  updatedAt: string;
};

type SharePayload =
  | { type: "conversation"; conversation: SharedConversation }
  | { type: "canvas"; canvas: SharedCanvas }
  | { type: "artifact"; artifact: SharedArtifact };

export default function SharedContentPage() {
  const params = useParams<{ token: string }>();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchShared() {
      try {
        const response = await fetch(`/api/share/${params.token}`);

        if (!response.ok) {
          if (!cancelled) setError("Conteúdo não encontrado ou link expirado.");
          return;
        }

        const data = (await response.json()) as SharePayload;
        if (!cancelled) setPayload(data);
      } catch {
        if (!cancelled) setError("Falha ao carregar o conteúdo compartilhado.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchShared();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{error ?? "Conteúdo não encontrado"}</p>
          <p className="mt-2 text-sm text-muted-foreground">O link pode estar expirado ou ser inválido.</p>
        </div>
      </div>
    );
  }

  if (payload.type === "conversation") {
    return <ConversationView conversation={payload.conversation} />;
  }

  const canvasLike = payload.type === "canvas" ? payload.canvas : payload.artifact;
  const dateLabel =
    payload.type === "canvas"
      ? new Date(payload.canvas.createdAt).toLocaleDateString("pt-BR")
      : new Date(payload.artifact.updatedAt).toLocaleDateString("pt-BR");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/60 bg-background/80 px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-sm font-medium">{canvasLike.title}</h1>
          <p className="text-xs text-muted-foreground">
            {payload.type === "canvas" ? "Canvas" : "Artefato"} · {canvasLike.kind}
            {canvasLike.language ? ` (${canvasLike.language})` : ""} — {dateLabel}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl py-4">
        <CanvasPreview
          content={canvasLike.content}
          kind={canvasLike.kind}
          language={canvasLike.language}
        />
      </div>
    </div>
  );
}

function ConversationView({ conversation }: { conversation: SharedConversation }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/60 bg-background/80 px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-sm font-medium">{conversation.title}</h1>
          <p className="text-xs text-muted-foreground">
            Conversa compartilhada — {new Date(conversation.createdAt).toLocaleDateString("pt-BR")}
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {conversation.messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-2.5 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {message.role === "user" ? <UserIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
            </div>
            <div className="max-w-[85%] sm:max-w-[75%]">
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                  message.role === "user"
                    ? "rounded-tr-md bg-primary text-primary-foreground"
                    : "rounded-tl-md bg-muted"
                }`}
              >
                {message.role === "assistant" ? (
                  <div className="prose-sm">
                    <MarkdownRenderer content={message.content} />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
