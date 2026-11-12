"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const API_BASE = "https://www.modelhub.com.br/v1";

type SnippetLanguage = "curl" | "python" | "javascript";

function buildCodeSnippets(apiKey: string): Record<SnippetLanguage, string> {
  const key = apiKey || "SUA_API_KEY";
  return {
    curl: `curl -X POST ${API_BASE}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${key}" \\\n  -d '{\n    "model": "${DEFAULT_MODEL_ID}",\n    "messages": [\n      {"role": "user", "content": "Olá!"}\n    ]\n  }'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(\n    api_key="${key}",\n    base_url="${API_BASE}"\n)\n\nresponse = client.chat.completions.create(\n    model="${DEFAULT_MODEL_ID}",\n    messages=[{"role": "user", "content": "Olá!"}]\n)\n\nprint(response.choices[0].message.content)`,
    javascript: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  apiKey: "${key}",\n  baseURL: "${API_BASE}",\n});\n\nconst response = await client.chat.completions.create({\n  model: "${DEFAULT_MODEL_ID}",\n  messages: [{ role: "user", content: "Olá!" }],\n});\n\nconsole.log(response.choices[0].message.content);`,
  };
}

export function ApiQuickStartCard({
  apiKey,
  hasApiKey,
}: {
  apiKey: string | null;
  hasApiKey: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SnippetLanguage>("curl");
  const [copied, setCopied] = useState(false);
  const snippets = buildCodeSnippets(apiKey ?? "");

  function handleCopy() {
    void navigator.clipboard.writeText(snippets[activeTab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const visibleKey = apiKey ? `${apiKey.slice(0, 8)}...` : "SUA_API_KEY";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chart-2/10">
          <TerminalSquareIcon className="size-4 text-chart-2" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Usar pela API</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Copie o código abaixo e substitua{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{visibleKey}</code> pela sua API
            key. O endpoint é 100% compatível com o SDK oficial da OpenAI.
          </p>
        </div>
      </div>

      {!hasApiKey && !apiKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          Crie uma API key primeiro para copiar o código com tudo preenchido automaticamente.
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SnippetLanguage)}>
        <TabsList className="grid w-full grid-cols-3 text-xs">
          <TabsTrigger value="curl">cURL</TabsTrigger>
          <TabsTrigger value="python">Python</TabsTrigger>
          <TabsTrigger value="javascript">JavaScript</TabsTrigger>
        </TabsList>
        {(["curl", "python", "javascript"] as const).map((lang) => (
          <TabsContent key={lang} value={lang}>
            <div className="group relative">
              <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3.5 text-xs leading-relaxed">
                <code>{snippets[lang]}</code>
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={handleCopy}
              >
                {copied && activeTab === lang ? (
                  <CheckIcon className="size-3.5 text-green-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <Button variant="outline" size="sm" onClick={handleCopy}>
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Código copiado" : "Copiar código"}
      </Button>
    </div>
  );
}
