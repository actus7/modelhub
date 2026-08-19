/**
 * Helpers para exportar conversas em JSON e Markdown (issues #175/#176).
 * Puramente client-side: sem dependência de DOM exceto `downloadTextFile`.
 */

export type ExportableConversationMeta = {
  createdAt?: string | Date | null;
  id?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  title?: string | null;
  updatedAt?: string | Date | null;
};

export type MarkdownExportMessage = {
  content: string;
  role: string;
};

export type JsonExportMessage = {
  content: string;
  createdAt?: string | Date | null;
  id?: string | null;
  modelLabel?: string | null;
  role: string;
};

function roleLabel(role: string): string {
  if (role === "user") return "Você";
  if (role === "assistant") return "Assistente";
  if (role === "system") return "Sistema";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Renderiza a conversa em Markdown legível. Quando `conversation` tem título,
 * o documento começa com `# <título>`; com `conversation` nulo (ex.: exportação
 * da conversa ativa sem metadados) o formato é idêntico ao histórico do chat.
 */
export function conversationToMarkdown(
  conversation: ExportableConversationMeta | null,
  messages: MarkdownExportMessage[],
): string {
  const body = messages
    .map((m) => `## ${roleLabel(m.role)}\n\n${m.content}`)
    .join("\n\n---\n\n");

  const title = conversation?.title?.trim();
  if (!title) return body;

  return `# ${title}\n\n${body}`;
}

/**
 * Serializa a conversa completa (metadados + mensagens + timestamps) em JSON.
 */
export function conversationToJson(
  conversation: ExportableConversationMeta | null,
  messages: JsonExportMessage[],
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      conversation: {
        createdAt: conversation?.createdAt ?? null,
        id: conversation?.id ?? null,
        modelId: conversation?.modelId ?? null,
        providerId: conversation?.providerId ?? null,
        title: conversation?.title ?? null,
        updatedAt: conversation?.updatedAt ?? null,
      },
      messages: messages.map((m) => ({
        content: m.content,
        createdAt: m.createdAt ?? null,
        id: m.id ?? null,
        modelLabel: m.modelLabel ?? null,
        role: m.role,
      })),
    },
    null,
    2,
  );
}

/**
 * Gera nome de arquivo seguro a partir do título da conversa.
 * Sem título (ou título irrelevante após normalização), cai para
 * `conversa-YYYY-MM-DD`, igual ao comportamento histórico do chat.
 */
export function buildExportFilename(
  title: string | null | undefined,
  extension: "json" | "md",
): string {
  const fallback = `conversa-${new Date().toISOString().slice(0, 10)}`;

  const slug = (title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^t[ií]tulo:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

  return `${slug || fallback}.${extension}`;
}

/**
 * Dispara o download de um arquivo de texto no navegador (padrão Blob + anchor).
 */
export function downloadTextFile(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari pode consumir o Blob apenas depois que o click retorna ao event loop.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
