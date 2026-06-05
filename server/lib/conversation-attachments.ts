import JSZip from "jszip";
import type { Prisma } from "../../generated/prisma/client.ts";

import {
  type AttachmentExtractionStatus,
  type AttachmentKind,
  type ConversationAttachmentDescriptor,
  type ConversationMessagePart,
  type HydratedConversationMessagePart,
} from "@/lib/chat-parts";

const IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DOCUMENT_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_IMAGE_ATTACHMENT_FILE_BYTES = Math.floor(1.5 * 1024 * 1024);
const MAX_IMAGE_ATTACHMENT_TOTAL_BYTES = Math.floor(2.5 * 1024 * 1024);
const MAX_DOCUMENT_ATTACHMENT_FILE_BYTES = Math.floor(5 * 1024 * 1024);
const MAX_DOCUMENT_ATTACHMENT_TOTAL_BYTES = Math.floor(10 * 1024 * 1024);
export const MAX_DOCUMENT_CONTEXT_CHARS = 120_000;

const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: "\"",
};

type StoredAttachmentRecord = {
  byteSize: number;
  extractionStatus: string;
  fileName: string;
  id: string;
  kind: string;
  mimeType: string;
};

type StoredMessagePart = {
  attachmentId?: unknown;
  fileName?: unknown;
  kind?: unknown;
  mimeType?: unknown;
  text?: unknown;
  type?: unknown;
};

export function buildAttachmentContentUrl(conversationId: string, attachmentId: string): string {
  return `/conversations/${conversationId}/attachments/${attachmentId}/content`;
}

export function resolveAttachmentKind(mimeType: string): AttachmentKind | null {
  if (IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return "image";
  }

  if (DOCUMENT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return "document";
  }

  return null;
}

function getAttachmentByteLimit(kind: AttachmentKind): number {
  return kind === "image" ? MAX_IMAGE_ATTACHMENT_FILE_BYTES : MAX_DOCUMENT_ATTACHMENT_FILE_BYTES;
}

export function getAttachmentValidationError(file: File): string | null {
  const kind = resolveAttachmentKind(file.type);
  if (!kind) {
    return `Tipo nao suportado: ${file.name}.`;
  }

  const limit = getAttachmentByteLimit(kind);
  if (file.size > limit) {
    return `Arquivo muito grande: ${file.name}.`;
  }

  return null;
}

function sanitizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return XML_ENTITY_MAP[entity] ?? match;
  });
}

function extractTaggedText(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, "gs");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const value = decodeXmlEntities(match[1].replace(/[<>]/g, ""));
    if (value.trim()) {
      values.push(value.trim());
    }
  }
  return values;
}

async function extractPdfText(buffer: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = Array.isArray(textContent.items) ? textContent.items : [];
    const pageText = items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .filter(Boolean)
      .join(" ");

    if (pageText.trim()) {
      pages.push(pageText.trim());
    }
  }

  return sanitizeExtractedText(pages.join("\n\n"));
}

async function extractDocxText(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const fileNames = zip.file(/word\/(document|header\d+|footer\d+)\.xml$/).map((file) => file.name);
  const segments: string[] = [];

  for (const fileName of fileNames) {
    const xml = await zip.file(fileName)?.async("text");
    if (!xml) {
      continue;
    }

    const paragraphs = extractTaggedText(xml, "w:t");
    if (paragraphs.length > 0) {
      segments.push(paragraphs.join(" "));
    }
  }

  return sanitizeExtractedText(segments.join("\n\n"));
}

async function extractPptxText(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = zip.file(/ppt\/slides\/slide\d+\.xml$/).map((file) => file.name).sort();
  const deckText: string[] = [];

  for (const slideName of slides) {
    const xml = await zip.file(slideName)?.async("text");
    if (!xml) {
      continue;
    }

    const slideText = extractTaggedText(xml, "a:t").join(" ");
    if (slideText.trim()) {
      deckText.push(slideText.trim());
    }
  }

  return sanitizeExtractedText(deckText.join("\n\n"));
}

function columnLabelToIndex(label: string): number {
  let value = 0;
  for (const char of label.toUpperCase()) {
    value = (value * 26) + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rowRegex = /<row\b[^>]*>(.*?)<\/row>/gs;
  const cellRegex = /<c\b([^>]*)>(.*?)<\/c>/gs;
  const rows: string[] = [];
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells = new Map<number, string>();
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const cellRef = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const cellType = /t="([^"]+)"/.exec(attrs)?.[1];
      if (!cellRef) {
        continue;
      }

      const cellIndex = columnLabelToIndex(cellRef);
      let value = "";
      const sharedIndex = /<v>(.*?)<\/v>/s.exec(cellMatch[2])?.[1];
      const inlineValue = extractTaggedText(cellMatch[2], "t").join(" ");

      if (cellType === "s" && sharedIndex) {
        value = sharedStrings[Number.parseInt(sharedIndex, 10)] ?? "";
      } else if (inlineValue) {
        value = inlineValue;
      } else if (sharedIndex) {
        value = decodeXmlEntities(sharedIndex);
      }

      if (value.trim()) {
        cells.set(cellIndex, value.trim());
      }
    }

    if (cells.size === 0) {
      continue;
    }

    const lastColumnIndex = Math.max(...cells.keys());
    const orderedCells: string[] = [];
    for (let columnIndex = 0; columnIndex <= lastColumnIndex; columnIndex += 1) {
      orderedCells.push(cells.get(columnIndex) ?? "");
    }
    rows.push(orderedCells.join("\t").trimEnd());
  }

  return rows.filter((row) => row.trim().length > 0);
}

async function extractXlsxText(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const sharedStrings = sharedStringsXml ? extractTaggedText(sharedStringsXml, "t") : [];
  const worksheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml$/).map((file) => file.name).sort();
  const sheets: string[] = [];

  for (const worksheetName of worksheetFiles) {
    const xml = await zip.file(worksheetName)?.async("text");
    if (!xml) {
      continue;
    }

    const rows = extractWorksheetRows(xml, sharedStrings);
    if (rows.length > 0) {
      sheets.push(rows.join("\n"));
    }
  }

  return sanitizeExtractedText(sheets.join("\n\n"));
}

export async function extractDocumentText(input: {
  buffer: Uint8Array;
  mimeType: string;
}): Promise<{ extractedText: string | null; extractionStatus: AttachmentExtractionStatus }> {
  try {
    let extractedText = "";
    switch (input.mimeType) {
      case "application/pdf":
        extractedText = await extractPdfText(input.buffer);
        break;
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        extractedText = await extractDocxText(input.buffer);
        break;
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        extractedText = await extractXlsxText(input.buffer);
        break;
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        extractedText = await extractPptxText(input.buffer);
        break;
      default:
        return { extractedText: null, extractionStatus: "failed" };
    }

    if (!extractedText) {
      return {
        extractedText: null,
        extractionStatus: input.mimeType === "application/pdf" ? "unsupported_scan" : "failed",
      };
    }

    return { extractedText, extractionStatus: "completed" };
  } catch (error) {
    console.error("[attachments] document extraction failed", error);
    return { extractedText: null, extractionStatus: "failed" };
  }
}

export async function readUploadedFile(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

function toAttachmentDescriptor(
  attachment: StoredAttachmentRecord,
  conversationId: string,
): ConversationAttachmentDescriptor {
  return {
    byteSize: attachment.byteSize,
    contentUrl: buildAttachmentContentUrl(conversationId, attachment.id),
    extractionStatus: attachment.extractionStatus as AttachmentExtractionStatus,
    fileName: attachment.fileName,
    id: attachment.id,
    kind: attachment.kind as AttachmentKind,
    mimeType: attachment.mimeType,
  };
}

function parseStoredMessageParts(value: Prisma.JsonValue | null, fallbackContent: string): ConversationMessagePart[] {
  if (!Array.isArray(value)) {
    return fallbackContent
      ? [{ text: fallbackContent, type: "text" }]
      : [];
  }

  const parts: ConversationMessagePart[] = [];
  for (const rawPart of value) {
    const part = rawPart as StoredMessagePart;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ text: part.text, type: "text" });
      continue;
    }

    if (
      part.type === "attachment" &&
      typeof part.attachmentId === "string" &&
      (part.kind === "image" || part.kind === "document") &&
      typeof part.fileName === "string" &&
      typeof part.mimeType === "string"
    ) {
      parts.push({
        attachmentId: part.attachmentId,
        fileName: part.fileName,
        kind: part.kind,
        mimeType: part.mimeType,
        type: "attachment",
      });
    }
  }

  if (parts.length === 0 && fallbackContent) {
    return [{ text: fallbackContent, type: "text" }];
  }

  return parts;
}

export function hydrateMessageParts(input: {
  attachmentsById: Map<string, StoredAttachmentRecord>;
  conversationId: string;
  fallbackContent: string;
  parts: Prisma.JsonValue | null;
}): HydratedConversationMessagePart[] {
  const storedParts = parseStoredMessageParts(input.parts, input.fallbackContent);
  return storedParts.reduce<HydratedConversationMessagePart[]>((result, part) => {
    if (part.type === "text") {
      result.push(part);
      return result;
    }

    const attachment = input.attachmentsById.get(part.attachmentId);
    if (!attachment) {
      return result;
    }

    result.push({ ...part, ...toAttachmentDescriptor(attachment, input.conversationId) });
    return result;
  }, []);
}

export function buildDocumentContextBlock(input: {
  extractedText: string | null;
  fileName: string;
  mimeType: string;
  remainingChars: number;
  status: AttachmentExtractionStatus;
}): { consumedChars: number; text: string } {
  if (input.remainingChars <= 0) {
    return { consumedChars: 0, text: "" };
  }

  const header = `[document:${input.fileName} mime=${input.mimeType}]`;
  if (!input.extractedText) {
    const suffix =
      input.status === "unsupported_scan"
        ? "Conteudo nao extraivel automaticamente (possivel scan)."
        : "Conteudo indisponivel.";
    const text = `${header}\n${suffix}\n[/document]`;
    return { consumedChars: 0, text };
  }

  const allowedText = input.extractedText.slice(0, Math.max(0, input.remainingChars));
  const truncated = allowedText.length < input.extractedText.length;
  const text = `${header}\n${allowedText}${truncated ? "\n[truncated]" : ""}\n[/document]`;
  return { consumedChars: allowedText.length, text };
}
