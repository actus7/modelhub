import { describe, expect, it } from "vitest";

import { buildDisplayText, detectCanvas, shouldRequestCanvasGuidance } from "./canvas-detector";

function fence(language: string, content: string): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

const longMermaid = [
  "graph TD",
  "  A[Início do fluxo de aprovação] --> B[Revisão técnica]",
  "  B --> C{Aprovado?}",
  "  C -- Sim --> D[Publicação]",
  "  C -- Não --> E[Ajustes e retorno]",
  "  E --> B",
  "  D --> F[Concluído com notificação]",
].join("\n");

const longCode = Array.from({ length: 22 }, (_, i) => `print("linha ${i + 1}")`).join("\n");

describe("detectCanvas", () => {
  it("detecta fence mermaid com >= 40 chars", () => {
    const suggestion = detectCanvas(`Intro\n\n${fence("mermaid", longMermaid)}\n\nOutro.`);
    expect(suggestion?.kind).toBe("mermaid");
    expect(suggestion?.language).toBe("mermaid");
    expect(suggestion?.content).toContain("graph TD");
    expect(suggestion?.sourceRange).toBeDefined();
  });

  it("ignora mermaid abaixo de 40 chars", () => {
    expect(detectCanvas(fence("mermaid", "graph TD\nA-->B"))).toBeNull();
  });

  it("mermaid tem prioridade sobre code/html", () => {
    const text = `${fence("mermaid", longMermaid)}\n${fence("python", longCode)}`;
    expect(detectCanvas(text)?.kind).toBe("mermaid");
  });

  it("detecta react (tsx) por linhas", () => {
    const content = [
      "export default function Demo() {",
      ...Array.from({ length: 20 }, (_, i) => `  <p>{${i}}</p>;`),
      "}",
    ].join("\n");
    const suggestion = detectCanvas(fence("tsx", content));
    expect(suggestion?.kind).toBe("react");
    expect(suggestion?.language).toBe("tsx");
  });

  it("detecta react (jsx) por chars", () => {
    const content = `const x = ${"1".repeat(800)};`;
    const suggestion = detectCanvas(fence("jsx", `<div>${content}</div>`));
    expect(suggestion?.kind).toBe("react");
  });

  it("detecta html por linhas ou chars", () => {
    const byLines = fence("html", Array.from({ length: 20 }, (_, i) => `<p>${i}</p>`).join("\n"));
    expect(detectCanvas(byLines)?.kind).toBe("html");

    const byChars = fence("html", `<div>${"a".repeat(800)}</div>`);
    expect(detectCanvas(byChars)?.kind).toBe("html");
  });

  it("detecta code genérico e guarda a linguagem", () => {
    const suggestion = detectCanvas(fence("python", longCode));
    expect(suggestion?.kind).toBe("code");
    expect(suggestion?.language).toBe("python");
  });

  it("code fica abaixo de react/html na prioridade", () => {
    const text = `${fence("python", longCode)}\n${fence("html", Array.from({ length: 20 }, (_, i) => `<p>${i}</p>`).join("\n"))}`;
    expect(detectCanvas(text)?.kind).toBe("html");
  });

  it("ignora fence sem linguagem (abaixo do limite markdown)", () => {
    const suggestion = detectCanvas(fence("", longCode));
    expect(suggestion).toBeNull();
  });

  it("aceita fence menor quando o usuário pediu canvas explicitamente", () => {
    const text = fence("html", '<main><h1>Clone do jogo</h1><button>Jogar</button></main>');
    const suggestion = detectCanvas(text, { explicitIntent: true });
    expect(suggestion).toMatchObject({ kind: "html", language: "html" });
  });

  it("limiares normais seguem valendo sem intenção explícita", () => {
    const text = fence("html", '<main><h1>Clone do jogo</h1><button>Jogar</button></main>');
    expect(detectCanvas(text)).toBeNull();
  });

  it("detecta markdown quando a mensagem inteira passa de 1500 chars", () => {
    const text = `# Relatório\n\n${"parágrafo com conteúdo suficiente. ".repeat(80)}`;
    const suggestion = detectCanvas(text);
    expect(suggestion?.kind).toBe("markdown");
    expect(suggestion?.content.length).toBeGreaterThan(1500);
    expect(suggestion?.displayText).toContain("# Relatório");
  });

  it("não detecta markdown abaixo de 1500 chars", () => {
    expect(detectCanvas(`# Curto\n\n${"x".repeat(200)}`)).toBeNull();
  });

  it("retorna null para texto vazio", () => {
    expect(detectCanvas("")).toBeNull();
    expect(detectCanvas("   \n  ")).toBeNull();
  });

  it("ignora fence não fechado (stream parcial)", () => {
    expect(detectCanvas("```mermaid\ngraph TD\nA-->B")).toBeNull();
  });

  it("título: heading primeiro, senão primeira linha, máx 60 chars", () => {
    const withHeading = detectCanvas(fence("python", `# Minha função\n${longCode}`));
    expect(withHeading?.title).toBe("Minha função");

    const withoutHeading = detectCanvas(fence("python", `def processar():\n${longCode}`));
    expect(withoutHeading?.title).toBe("def processar():");

    const long = detectCanvas(`# ${"a".repeat(100)}\n\n${"b".repeat(1500)}`);
    expect(long?.title.length).toBeLessThanOrEqual(60);
  });
});

describe("shouldRequestCanvasGuidance", () => {
  it.each([
    "Não pode fazer o canva?",
    "Eu quero ver o canvas",
    "Abra um canvas para isso",
    "Quero um clone de um jogo",
    "Crie uma landing page",
    "Monte um diagrama",
  ])("ativa para intenção visual: %s", (text) => {
    expect(shouldRequestCanvasGuidance(text)).toBe(true);
  });

  it.each([
    "oi",
    "Explique o que é Python",
    "Resuma esse texto",
    "Qual a previsão do tempo?",
  ])("não ativa para conversa comum: %s", (text) => {
    expect(shouldRequestCanvasGuidance(text)).toBe(false);
  });
});

describe("buildDisplayText", () => {
  it("remove o fence mermaid e mantém o texto ao redor", () => {
    const full = `Antes\n\n${fence("mermaid", longMermaid)}\n\nDepois`;
    const suggestion = detectCanvas(full);
    expect(suggestion).not.toBeNull();
    expect(buildDisplayText(full, suggestion!)).toBe("Antes\n\nDepois");
  });

  it("markdown usa o primeiro parágrafo", () => {
    const full = `# Título\n\n${"conteúdo ".repeat(300)}`;
    const suggestion = detectCanvas(full);
    expect(buildDisplayText(full, suggestion!)).toBe("# Título");
  });

  it("sem sobra de texto, retorna vazio para fence", () => {
    const full = fence("mermaid", longMermaid);
    const suggestion = detectCanvas(full);
    expect(buildDisplayText(full, suggestion!)).toBe("");
  });
});
