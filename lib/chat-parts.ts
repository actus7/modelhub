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

export type ConversationMessagePart = AttachmentReferencePart | TextPart;

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

export type HydratedConversationMessagePart = HydratedAttachmentPart | TextPart;

export function createMessageContentFallback(
  parts: readonly ConversationMessagePart[],
): string {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
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
