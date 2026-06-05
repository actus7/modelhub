import type { AttachmentKind } from "@/lib/chat-parts";
import { ACCEPTED_DOCUMENT_TYPES, ACCEPTED_IMAGE_TYPES } from "@/lib/chat-utils";

export const MAX_ATTACHMENT_FILE_BYTES = Math.floor(1.5 * 1024 * 1024);
export const MAX_TOTAL_ATTACHMENT_BYTES = Math.floor(2.5 * 1024 * 1024);
export const MAX_SERIALIZED_CHAT_REQUEST_BYTES = Math.floor(3.5 * 1024 * 1024);
export const MAX_DOCUMENT_ATTACHMENT_FILE_BYTES = Math.floor(5 * 1024 * 1024);
export const MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES = Math.floor(10 * 1024 * 1024);

type AttachmentLike = {
  size: number;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getTotalAttachmentBytes(attachments: AttachmentLike[]): number {
  return attachments.reduce((total, attachment) => total + attachment.size, 0);
}

function getTotalAttachmentBytesByType<T extends AttachmentLike & { kind: "document" | "image" }>(
  attachments: T[],
  kind: T["kind"],
): number {
  return attachments
    .filter((attachment) => attachment.kind === kind)
    .reduce((total, attachment) => total + attachment.size, 0);
}

export function estimateSerializedPayloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function isSerializedPayloadTooLarge(
  payload: unknown,
  maxBytes = MAX_SERIALIZED_CHAT_REQUEST_BYTES,
): boolean {
  return estimateSerializedPayloadBytes(payload) > maxBytes;
}

/**
 * Classifies and validates a batch of files against the model capabilities and
 * the per-file / cumulative byte budgets. Returns the accepted files (with their
 * resolved kind) and a list of human-readable error messages — the caller is
 * responsible for the side effects (showing toasts, creating preview URLs).
 *
 * Pure: error paths skip a file without consuming budget, so the byte
 * accumulators only advance for accepted files.
 */
export function validateFileSelection(
  files: File[],
  currentAttachments: { kind: AttachmentKind; size: number }[],
  caps: { allowImages: boolean; allowDocuments: boolean },
): { accepted: { file: File; kind: AttachmentKind }[]; errors: string[] } {
  const accepted: { file: File; kind: AttachmentKind }[] = [];
  const errors: string[] = [];

  let totalImageBytes = getTotalAttachmentBytesByType(currentAttachments, "image");
  let totalDocumentBytes = getTotalAttachmentBytesByType(currentAttachments, "document");

  for (const file of files) {
    const isImage = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
    const isDocument = (ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(file.type);

    if (!isImage && !isDocument) {
      errors.push(`Tipo nao suportado: ${file.name}.`);
      continue;
    }

    if (isImage && !caps.allowImages) {
      errors.push("O modelo selecionado nao aceita imagens.");
      continue;
    }

    if (isDocument && !caps.allowDocuments) {
      errors.push("O modelo selecionado nao aceita documentos.");
      continue;
    }

    if (isImage) {
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        errors.push(`Arquivo muito grande: ${file.name}. Maximo ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)} por imagem.`);
        continue;
      }
      if (totalImageBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        errors.push(`Limite total de imagens excedido. Use ate ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} por mensagem.`);
        continue;
      }
      totalImageBytes += file.size;
      accepted.push({ file, kind: "image" });
    } else {
      if (file.size > MAX_DOCUMENT_ATTACHMENT_FILE_BYTES) {
        errors.push(`Arquivo muito grande: ${file.name}. Maximo ${formatBytes(MAX_DOCUMENT_ATTACHMENT_FILE_BYTES)} por documento.`);
        continue;
      }
      if (totalDocumentBytes + file.size > MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES) {
        errors.push(`Limite total de documentos excedido. Use ate ${formatBytes(MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES)} por mensagem.`);
        continue;
      }
      totalDocumentBytes += file.size;
      accepted.push({ file, kind: "document" });
    }
  }

  return { accepted, errors };
}
