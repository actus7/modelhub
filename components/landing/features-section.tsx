import {
  BrainCircuitIcon,
  GlobeIcon,
  KeyRoundIcon,
  MessageSquareTextIcon,
  PlugIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: GlobeIcon,
    title: "Sem instalação",
    description:
      "Use direto no browser. Não precisa instalar nada na sua máquina — cadastre-se e comece a conversar.",
  },
  {
    icon: MessageSquareTextIcon,
    title: "Chat Integrado",
    description:
      "Interface de chat completa com suporte a streaming, histórico de conversas e troca de modelo em tempo real.",
  },
  {
    icon: PlugIcon,
    title: "API Compatível",
    description:
      "Endpoint /v1/chat/completions compatível com a API da OpenAI. Substitua a base URL e use suas ferramentas favoritas.",
  },
  {
    icon: BrainCircuitIcon,
    title: "Múltiplos Providers",
    description:
      "Conecte-se a OpenAI, Google, Groq, Mistral, DeepSeek, OpenRouter e qualquer API compatível com OpenAI — tudo em uma única plataforma.",
  },
  {
    icon: KeyRoundIcon,
    title: "Gerenciamento de Chaves",
    description:
      "Crie API keys para acesso programático e armazene credenciais de providers de forma segura no servidor.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Seguro por Padrão",
    description:
      "Autenticação robusta, credenciais criptografadas, sessões isoladas por usuário e proteção contra abusos.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section className="px-6 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Tudo o que você precisa para trabalhar com IA
          </h2>
          <p className="mt-3 text-muted-foreground">
            Uma plataforma completa para centralizar, gerenciar e consumir modelos de inteligência
            artificial. Sem configuração complexa, sem dependências.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="border-border/60 bg-card/80 backdrop-blur">
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="size-5" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
