"use client";

import { useState } from "react";
import { CheckIcon, CodeIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { AuthButtons } from "@/components/landing/auth-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const API_BASE = "https://www.modelhub.com.br/v1";

const codeSnippets = {
  curl: `curl -X POST ${API_BASE}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer SUA_API_KEY" \\
  -d '{
    "model": "${DEFAULT_MODEL_ID}",
    "messages": [
      {"role": "user", "content": "Olá!"}
    ]
  }'`,
  python: `from openai import OpenAI

client = OpenAI(
    api_key="SUA_API_KEY",
    base_url="${API_BASE}"
)

response = client.chat.completions.create(
    model="${DEFAULT_MODEL_ID}",
    messages=[{"role": "user", "content": "Olá!"}]
)

print(response.choices[0].message.content)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "SUA_API_KEY",
  baseURL: "${API_BASE}",
});

const response = await client.chat.completions.create({
  model: "${DEFAULT_MODEL_ID}",
  messages: [{ role: "user", content: "Olá!" }],
});

console.log(response.choices[0].message.content);`,
} as const;

type SnippetLanguage = keyof typeof codeSnippets;

const languageLabels: Record<SnippetLanguage, string> = {
  curl: "cURL",
  python: "Python",
  javascript: "JavaScript",
};

export function ApiQuickStartSection() {
  const [activeTab, setActiveTab] = useState<SnippetLanguage>("curl");
  const [copied, setCopied] = useState(false);

  function handleCopySnippet() {
    void navigator.clipboard.writeText(codeSnippets[activeTab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="border-t border-border/60 bg-muted/30 px-6 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs">
            <CodeIcon className="size-3" />
            API OpenAI-compatível
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Use com qualquer ferramenta que você já conhece
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Troque a base URL do seu código existente e pronto. A API do ModelHub é 100% compatível
            com a OpenAI — funciona com o SDK oficial, LangChain, Assistants e qualquer cliente que
            suporte o formato{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
              /v1/chat/completions
            </code>
            .
          </p>
        </div>

        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-border/60 bg-background p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
                <TerminalIcon className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Substitua a base URL e use</p>
                <p className="text-xs text-muted-foreground">
                  Mesmo SDK, mesma resposta — só muda o endpoint.
                </p>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-1 rounded-lg bg-muted p-1">
              {(Object.keys(codeSnippets) as SnippetLanguage[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveTab(lang)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === lang
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {languageLabels[lang]}
                </button>
              ))}
            </div>

            <div className="group relative">
              <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3.5 text-xs leading-relaxed">
                <code>{codeSnippets[activeTab]}</code>
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={handleCopySnippet}
              >
                {copied ? (
                  <CheckIcon className="size-3.5 text-green-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={handleCopySnippet} variant="outline" size="sm">
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                {copied ? "Código copiado" : "Copiar código"}
              </Button>
              <AuthButtons size="sm" />
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-background p-4 text-center shadow-sm">
              <p className="text-sm font-medium">Sem instalação</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Use direto no browser ou pela API. Nenhum runtime extra necessário.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-4 text-center shadow-sm">
              <p className="text-sm font-medium">SDK oficial</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Funciona com os SDKs Python e JavaScript da OpenAI sem alterar o código.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-4 text-center shadow-sm">
              <p className="text-sm font-medium">Mesma resposta</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Formato idêntico ao da OpenAI. Troque a URL e mantenha tudo igual.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
