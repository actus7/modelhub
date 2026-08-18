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

/**
 * Instrução oculta enviada apenas quando a mensagem indica intenção de criar ou
 * abrir um canvas. Evita que o modelo confunda o workspace com Canva.com e o
 * orienta a produzir um formato que o detector consegue abrir.
 */
export const CANVAS_ASSISTANT_GUIDANCE = [
  "[capacidade do ModelHub: Canvas]",
  "O usuário está pedindo um canvas interativo dentro do ModelHub, não o site Canva.com.",
  "Crie o conteúdo diretamente nesta resposta em UM bloco fenced completo:",
  "- interface, jogo ou página: use ```html ou ```tsx com implementação funcional e autocontida;",
  "- diagrama: use ```mermaid;",
  "- documento longo: use Markdown estruturado.",
  "Não explique como acessar ferramentas externas. Entregue o artefato pronto para o painel Canvas.",
].join("\n");

const CANVAS_INTENT_RE = /\b(?:canvas|canva|quadro|artefato|preview|visualiza(?:r|ção)|abr(?:ir|a)|mostrar|ver)\b/i;
const CREATION_INTENT_RE = /\b(?:cri(?:ar|e)|faz(?:er|a)|mont(?:ar|e)|ger(?:ar|e)|constru(?:ir|a)|clone|prototip(?:ar|e))\b/i;
const VISUAL_ARTIFACT_RE = /\b(?:site|página|pagina|landing|interface|componente|app|aplicativo|jogo|game|diagrama|fluxograma|dashboard|layout|html|react|mermaid)\b/i;

export function shouldRequestCanvasGuidance(userText: string): boolean {
  const normalized = userText.trim();
  if (!normalized) return false;
  return CANVAS_INTENT_RE.test(normalized) ||
    (CREATION_INTENT_RE.test(normalized) && VISUAL_ARTIFACT_RE.test(normalized));
} 

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
  /**
 * Fences no padrão CommonMark: até 3 espaços de indentação na abertura e no
 * fechamento, espaço opcional antes da linguagem ("``` html") e sufixos de
 * info-string tolerados. O range retornado inclui a indentação.
 */
const fenceRegex = /^ {0,3}```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n?^ {0,3}```[ \t]*$/gm;
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
export function detectCanvas(
  fullText: string,
  options?: { explicitIntent?: boolean },
): CanvasSuggestion | null {
  if (!fullText.trim()) return null;

  const blocks = extractFencedBlocks(fullText);
  const eligibleFence = (content: string) =>
    options?.explicitIntent ? content.trim().length >= MERMAID_MIN_CHARS : meetsSizeThreshold(content);

  const mermaid = blocks.find(
    (block) => block.language === "mermaid" && block.content.trim().length >= MERMAID_MIN_CHARS,
  );
  if (mermaid) return fencedSuggestion(mermaid, "mermaid", "mermaid");

  const react = blocks.find(
    (block) => REACT_LANGS.has(block.language) && eligibleFence(block.content),
  );
  if (react) return fencedSuggestion(react, "react", react.language);

  const html = blocks.find(
    (block) => block.language === "html" && eligibleFence(block.content),
  );
  if (html) return fencedSuggestion(html, "html", "html");

  const code = blocks.find(
    (block) =>
      block.language !== "" &&
      block.language !== "mermaid" &&
      block.language !== "html" &&
      !REACT_LANGS.has(block.language) &&
      eligibleFence(block.content),
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
