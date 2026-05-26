import { Badge } from "@/components/ui/badge";

const providerNames = [
  "OpenAI",
  "Google AI Studio",
  "Groq",
  "Mistral",
  "Cerebras",
  "Cohere",
  "NVIDIA NIM",
  "Hugging Face",
  "GitHub Models",
  "OpenRouter",
  "Cloudflare Workers AI",
  "Duck AI",
  "Codestral",
  "Puter Xiaomi MiMo",
];

export function ProvidersSection() {
  return (
    <section className="px-6 py-16 md:py-24">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Providers suportados
        </h2>
        <p className="mt-3 text-muted-foreground">
          Integração nativa com os principais providers de IA do mercado.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {providerNames.map((name) => (
            <Badge
              key={name}
              variant="outline"
              className="px-3 py-1.5 text-sm font-normal"
            >
              {name}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
