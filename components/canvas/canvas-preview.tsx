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

export function CanvasPreview({ content, kind, language }: CanvasPreviewProps) {
  if (kind === "markdown") {
    return <div className="p-5"><MarkdownRenderer content={content} /></div>;
  }
  if (kind === "html") {
    return <iframe className="h-full min-h-[420px] w-full border-0 bg-white" sandbox="allow-scripts" srcDoc={content} title="Preview HTML" />;
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
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ securityLevel: "strict", startOnLoad: false, theme: resolvedTheme === "dark" ? "dark" : "default" });
        const result = await mermaid.render(`canvas-${id}`, content);
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
          presets: ["react", "typescript"],
        }).code;
        const runtime = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><script crossorigin src="https://unpkg.com/react@19/umd/react.development.js"></script><script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.development.js"></script><style>body{margin:0;padding:20px;font-family:ui-sans-serif,system-ui;color:#18181b}*{box-sizing:border-box}.error{white-space:pre-wrap;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px}</style></head><body><div id="root"></div><script>window.onerror=(m,s,l,c,e)=>{document.getElementById('root').innerHTML='<pre class="error">'+String(e?.stack||m).replace(/</g,'&lt;')+'</pre>'};try{${code};const C=${componentName};ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C));}catch(e){window.onerror(e.message,'',0,0,e)}</script></body></html>`;
        if (!cancelled) { setSrcDoc(runtime); setError(null); }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Falha na compilação");
      }
    }
    void compile();
    return () => { cancelled = true; };
  }, [content, language]);

  if (error) return <ErrorPanel detail={error} title="Não foi possível compilar o componente" />;
  return <iframe className="h-full min-h-[420px] w-full border-0 bg-white" sandbox="allow-scripts" srcDoc={srcDoc} title="Preview React" />;
}
