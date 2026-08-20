"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { CanvasKind } from "@/lib/contracts";

export type CanvasPreviewProps = {
  content: string;
  kind: CanvasKind;
  language?: string | null;
};

const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function buildSandboxedHtmlDocument(content: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`;
  if (/<head(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<html(?:\s[^>]*)?>/i, (html) => `${html}<head>${policy}</head>`);
  }
  return `<!doctype html><html><head>${policy}</head><body>${content}</body></html>`;
}

export function escapeInlineScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export function buildMermaidConfig(resolvedTheme: string | undefined) {
  return {
    securityLevel: "strict" as const,
    startOnLoad: false,
    // Mermaid otherwise renders its own error SVG and throws before removing
    // the temporary element, leaking raw parser output into document.body.
    suppressErrorRendering: true,
    theme: resolvedTheme === "dark" ? ("dark" as const) : ("default" as const),
  };
}

export function CanvasPreview({ content, kind, language }: CanvasPreviewProps) {
  if (kind === "markdown") {
    return <div className="p-5"><MarkdownRenderer content={content} /></div>;
  }
  if (kind === "html") {
    return <iframe className="h-full min-h-[420px] w-full border-0 bg-white" referrerPolicy="no-referrer" sandbox="allow-scripts" srcDoc={buildSandboxedHtmlDocument(content)} title="Preview HTML" />;
  }
  if (kind === "mermaid") return <MermaidPreview content={content} />;
  if (kind === "react") return <ReactPreview content={content} language={language ?? "tsx"} />;
  return <CodePreview content={content} language={language ?? "text"} />;
}

function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive"><AlertTriangleIcon className="size-4" />{title}</div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{detail}</pre>
    </div>
  );
}

function CodePreview({ content, language }: { content: string; language: string }) {
  const [Editor, setEditor] = useState<React.ComponentType<{ value: string; height: string; editable: boolean; theme?: string; extensions?: unknown[] }> | null>(null);
  const [extensions, setExtensions] = useState<unknown[]>([]);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ default: CodeMirror }, extension] = await Promise.all([
        import("@uiw/react-codemirror"),
        loadLanguageExtension(language),
      ]);
      if (!cancelled) {
        setEditor(() => CodeMirror as typeof Editor);
        setExtensions(extension ? [extension] : []);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [language]);

  if (!Editor) return <div className="flex h-48 items-center justify-center"><Loader2Icon className="size-5 animate-spin text-muted-foreground" /></div>;
  return <Editor editable={false} extensions={extensions} height="100%" theme={resolvedTheme === "dark" ? "dark" : "light"} value={content} />;
}

async function loadLanguageExtension(language: string): Promise<unknown | null> {
  const normalized = language.toLowerCase();
  if (["js", "javascript", "jsx", "ts", "typescript", "tsx"].includes(normalized)) {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: normalized.includes("x"), typescript: normalized.startsWith("t") });
  }
  if (["html", "xml"].includes(normalized)) return (await import("@codemirror/lang-html")).html();
  if (normalized === "css") return (await import("@codemirror/lang-css")).css();
  if (["md", "markdown"].includes(normalized)) return (await import("@codemirror/lang-markdown")).markdown();
  return null;
}

function MermaidPreview({ content }: { content: string }) {
  const id = useId().replaceAll(":", "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const container = containerRef.current;
        if (!container) return;
        container.replaceChildren();
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(buildMermaidConfig(resolvedTheme));
        const result = await mermaid.render(`canvas-${id}`, content, container);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = result.svg;
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Diagrama inválido");
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [content, id, resolvedTheme]);

  if (error) return <ErrorPanel detail={error} title="Não foi possível renderizar o diagrama" />;
  return <div ref={containerRef} className="flex min-h-[320px] items-center justify-center overflow-auto p-6 [&_svg]:max-w-full" />;
}

function ReactPreview({ content, language }: { content: string; language: string }) {
  const [srcDoc, setSrcDoc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function compile() {
      try {
        const Babel = await import("@babel/standalone");
        const normalized = content
          .replace(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)/, "function $1")
          .replace(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/, "const __CanvasComponent = $1;");
        const componentMatch = normalized.match(/function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/);
        const componentName = normalized.includes("__CanvasComponent") ? "__CanvasComponent" : (componentMatch?.[1] ?? "App");
        const code = Babel.transform(normalized, {
          filename: language === "jsx" ? "canvas.jsx" : "canvas.tsx",
          plugins: ["transform-modules-commonjs"],
          presets: ["react", "typescript"],
        }).code;
        const safeCode = escapeInlineScript(code ?? "");
        const runtime = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://esm.sh; style-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'"><script type="importmap">{"imports":{"react":"https://esm.sh/react@19.2.8","react-dom/client":"https://esm.sh/react-dom@19.2.8/client"}}</script><style>body{margin:0;padding:20px;font-family:ui-sans-serif,system-ui;color:#18181b}*{box-sizing:border-box}.error{white-space:pre-wrap;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px}</style></head><body><div id="root"></div><script type="module">import * as __React from "react";import {createRoot as __createRoot} from "react-dom/client";globalThis.React=__React;const reportError=(value)=>{const root=document.getElementById('root');const pre=document.createElement('pre');pre.className='error';pre.textContent=String(value);root.replaceChildren(pre)};window.onerror=(m,s,l,c,e)=>{reportError(e?.stack||m);return true};const module={exports:{}};const exports=module.exports;const require=(id)=>{if(id==='react')return __React;if(id==='react-dom/client')return{createRoot:__createRoot};throw new Error('Import não suportado no preview: '+id)};try{${safeCode};const C=typeof ${componentName}==='undefined'?(module.exports.default||exports.default):${componentName};if(typeof C!=='function')throw new Error('Componente React não encontrado');__createRoot(document.getElementById('root')).render(__React.createElement(C));}catch(e){reportError(e?.stack||e)}</script></body></html>`;
        if (!cancelled) { setSrcDoc(runtime); setError(null); }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Falha na compilação");
      }
    }
    void compile();
    return () => { cancelled = true; };
  }, [content, language]);

  if (error) return <ErrorPanel detail={error} title="Não foi possível compilar o componente" />;
  return <iframe className="h-full min-h-[420px] w-full border-0 bg-white" referrerPolicy="no-referrer" sandbox="allow-scripts" srcDoc={srcDoc} title="Preview React" />;
}
