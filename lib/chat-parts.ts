export type AttachmentKind = "document" | "image";

export type AttachmentExtractionStatus =
  | "completed"
  | "failed"
  | "processing"
  | "unsupported_scan";

export type ProviderModelCapabilities = {
  documents: boolean;
  images: boolean;
  tools?: boolean;
  reasoning?: boolean;
  fast?: boolean;
};

type AttachmentReferencePart = {
  attachmentId: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string;
  type: "attachment";
};

type TextPart = {
  text: string;
  type: "text";
};

type MetaPart = {
  modelLabel: string;
  type: "meta";
};

type CanvasReferencePart = {
  canvasId: string;
  /** CanvasKind: markdown | code | html | react | mermaid */
  kind: string;
  title: string;
  type: "canvas";
};

export type ConversationMessagePart =
  | AttachmentReferencePart
  | CanvasReferencePart
  | MetaPart
  | TextPart;

export type ConversationAttachmentDescriptor = {
  byteSize: number;
  contentUrl: string;
  extractionStatus: AttachmentExtractionStatus;
  fileName: string;
  id: string;
  kind: AttachmentKind;
  mimeType: string;
};

export type HydratedAttachmentPart = AttachmentReferencePart & ConversationAttachmentDescriptor;

export type HydratedConversationMessagePart =
  | CanvasReferencePart
  | HydratedAttachmentPart
  | MetaPart
  | TextPart;

export function createMessageContentFallback(
  parts: readonly ConversationMessagePart[],
): string {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "meta") {
        return "";
      }
      if (part.type === "canvas") {
        return `[canvas] ${part.title}`;
      }

      return `[${part.kind}] ${part.fileName}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function extractPlainTextFromParts(
  parts: readonly ConversationMessagePart[] | readonly HydratedConversationMessagePart[],
): string {
  return parts.reduce((text, part) => {
    if (part.type !== "text") {
      return text;
    }

    return `${text}${part.text}`;
  }, "").trim();
}
