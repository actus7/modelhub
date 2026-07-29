"use client";

import { useCallback, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
        "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white",
        className,
      )}
      title={copied ? "Copiado!" : "Copiar código"}
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

/**
 * Normalise common markdown issues produced by smaller / code-focused models:
 *
 * 1. Fenced code blocks whose opening ``` is glued to the preceding text
 *    (missing blank line before the fence).
 * 2. Closing ``` glued to the next paragraph (missing blank line after).
 * 3. Code fences that appear inline within a single line of prose, e.g.
 *    "some text ```python\ncode\n``` more text" — we ensure they sit on
 *    their own lines so react-markdown parses them as blocks.
 */
function normaliseMarkdown(raw: string): string {
  // Ensure a blank line before opening fences: ```, ```lang
  const withPreFence = raw.replaceAll(/([^\n])\n?(```\w*)/g, '$1\n\n$2');

  // Ensure a blank line after closing fences
  return withPreFence.replaceAll(/(```)(\n?)([^\n`])/g, '$1\n\n$3');
}

export function MarkdownRenderer({ content }: { content: string }) {
  const normalised = normaliseMarkdown(content);

  return (
    <div className="markdown-renderer min-w-0 max-w-full overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        skipHtml
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: ({ children, ...props }) => {
            // Extract text from code children
            const codeText = extractTextFromChildren(children);
            return (
              <div className="group/code relative">
                <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/code:opacity-100">
                  <CopyButton text={codeText} />
                </div>
                <pre {...props}>{children}</pre>
              </div>
            );
          },
          code: ({ className, children, ...props }) => (
            <code className={className} {...props}>
              {children}
            </code>
          ),
          table: ({ children, ...props }) => (
            <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-border">
              <table className="min-w-max" {...props}>
                {children}
              </table>
            </div>
          ),
        }}
      >
        {normalised}
      </ReactMarkdown>
    </div>
  );
}

/** Recursively extract text content from React children */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (typeof children === "object" && "props" in children) {
    return extractTextFromChildren((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}
