import type { CanvasKind } from "@/lib/contracts";

/**
 * Detecção client-side de canvas a partir da resposta do assistente.
 * Determinística e pura: pode rodar sobre texto parcial (durante o stream)
 * ou sobre o texto completo (ao final).
 */

export type CanvasSuggestion = {
  kind: CanvasKind;
  content: string;
  language: string | null;
  title: string;
  /** Para fences: [início, fim) do bloco no texto completo. */
  sourceRange?: [number, number];
  /** Para markdown: primeiro parágrafo (texto de exibição da bolha). */
  displayText?: string;
};

const MERMAID_MIN_CHARS = 40;
const FENCED_MIN_LINES = 20;
const FENCED_MIN_CHARS = 800;
const MARKDOWN_MIN_CHARS = 1500;
const TITLE_MAX_CHARS = 60;

const REACT_LANGS = new Set(["tsx", "jsx"]);

type FencedBlock = {
  language: string;
  content: string;
  start: number;
  end: number;
};

function extractFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const fenceRegex = /^```([\w-]*)[^\n]*\n([\s\S]*?)\n?^```\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    blocks.push({
      content: match[2] ?? "",
      end: match.index + match[0].length,
      language: (match[1] ?? "").toLowerCase(),
      start: match.index,
    });
  }
  return blocks;
}

function countLines(text: string): number {
  let lines = 0;
  for (const line of text.split("\n")) {
    if (line.trim()) lines += 1;
  }
  return lines;
}

function meetsSizeThreshold(content: string): boolean {
  return countLines(content) >= FENCED_MIN_LINES || content.length >= FENCED_MIN_CHARS;
}

function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Canvas";
  return cleaned.length > TITLE_MAX_CHARS ? `${cleaned.slice(0, TITLE_MAX_CHARS - 1)}…` : cleaned;
}

function extractTitle(content: string): string {
  const heading = content.match(/^#{1,6}\s+(.+)$/m);
  if (heading?.[1]) return sanitizeTitle(heading[1]);
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return sanitizeTitle(trimmed);
  }
  return "Canvas";
}

function fencedSuggestion(
  block: FencedBlock,
  kind: CanvasKind,
  language: string | null,
): CanvasSuggestion {
  const content = block.content.trim();
  return {
    content,
    kind,
    language,
    sourceRange: [block.start, block.end],
    title: extractTitle(content),
  };
}

/**
 * Detecta a sugestão de canvas mais forte em um texto.
 * Prioridade: mermaid > react/html > code > markdown. Emite no máximo UMA.
 */
export function detectCanvas(fullText: string): CanvasSuggestion | null {
  if (!fullText.trim()) return null;

  const blocks = extractFencedBlocks(fullText);

  const mermaid = blocks.find(
    (block) => block.language === "mermaid" && block.content.trim().length >= MERMAID_MIN_CHARS,
  );
  if (mermaid) return fencedSuggestion(mermaid, "mermaid", "mermaid");

  const react = blocks.find(
    (block) => REACT_LANGS.has(block.language) && meetsSizeThreshold(block.content),
  );
  if (react) return fencedSuggestion(react, "react", react.language);

  const html = blocks.find(
    (block) => block.language === "html" && meetsSizeThreshold(block.content),
  );
  if (html) return fencedSuggestion(html, "html", "html");

  const code = blocks.find(
    (block) =>
      block.language !== "" &&
      block.language !== "mermaid" &&
      block.language !== "html" &&
      !REACT_LANGS.has(block.language) &&
      meetsSizeThreshold(block.content),
  );
  if (code) return fencedSuggestion(code, "code", code.language);

  if (fullText.trim().length >= MARKDOWN_MIN_CHARS) {
    const trimmed = fullText.trim();
    const firstParagraph = trimmed.split(/\n{2,}/)[0]?.trim() ?? "";
    return {
      content: trimmed,
      displayText: firstParagraph,
      kind: "markdown",
      language: null,
      title: extractTitle(trimmed),
    };
  }

  return null;
}

/**
 * Texto exibido na bolha após criar o canvas:
 * fence → texto fora do fence; markdown → primeiro parágrafo.
 */
export function buildDisplayText(fullText: string, suggestion: CanvasSuggestion): string {
  if (suggestion.kind === "markdown") {
    return suggestion.displayText ?? "";
  }
  if (suggestion.sourceRange) {
    const [start, end] = suggestion.sourceRange;
    return `${fullText.slice(0, start)}${fullText.slice(end)}`
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return fullText;
}
