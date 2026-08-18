import { describe, expect, it } from "vitest";
import { buildDisplayText, detectCanvas } from "./canvas-detector";

// Reprodução fiel (estrutura) da resposta real do usuário em produção:
// fences malformados sem linguagem (com "markdown" como 1ª linha do conteúdo)
// e um fence python grande no final.
const realResponse = `Claro! Posso te ajudar a criar designs, layouts ou ideias para o Canva usando Markdown para explicar o passo a passo.

Aqui estão algumas sugestões:

\`\`\`
markdown
1. Acesse o site
2. Faça login
3. Escolha um modelo
\`\`\`

Mais texto explicativo suficiente para passar do limite de markdown da mensagem inteira.

\`\`\`
markdown
1. **Adicionar elementos**
   - Clique em Elementos
   - Procure formas
\`\`\`

4. Exemplo de Código para Gerar um Design:

\`\`\`python
from PIL import Image, ImageDraw, ImageFont

# Criar uma imagem em branco (90x50 mm = 354x194 pixels para 300 DPI)
width, height = 354, 194
img = Image.new("RGB", (width, height), color=(255, 255, 255))
draw = ImageDraw.Draw(img)

# Carregar uma fonte (voce pode baixar uma fonte como Arial.ttf)
try:
    font = ImageFont.truetype("arial.ttf", 20)
except:
    font = ImageFont.load_default()

# Definir cores
cor_texto = (0, 0, 0)  # Preto
cor_fundo = (50, 50, 50)  # Cinza escuro

# Desenhar texto
draw.text((20, 20), "Joao Silva", font=font, fill=cor_texto)
draw.text((20, 50), "Desenvolvedor Full Stack", font=font, fill=cor_texto)
draw.text((20, 80), "joao@example.com", font=font, fill=cor_texto)
draw.text((20, 110), "LinkedIn: linkedin.com/in/joao", font=font, fill=cor_texto)

# Salvar a imagem
img.save("cartao_visita.png")
print("Cartao de visita gerado!")
\`\`\`

Observação final do modelo aqui.

Como posso te ajudar especificamente? Diga-me: qual tipo de design você quer criar? Qual é o objetivo? Prefere um guia passo a passo ou um template pronto? Estou aqui para ajudar!`;

describe("reprodução do caso real reportado", () => {
  it("detecta o fence python grande como canvas code", () => {
    const suggestion = detectCanvas(realResponse);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.kind).toBe("code");
    expect(suggestion!.language).toBe("python");
  });

  it("remove o fence do texto da bolha e mantém o resto", () => {
    const suggestion = detectCanvas(realResponse)!;
    const display = buildDisplayText(realResponse, suggestion);
    expect(display).not.toContain("from PIL");
    expect(display).toContain("Claro! Posso te ajudar");
    expect(display).toContain("Observação final");
  });

  it("fences sem linguagem não viram canvas code", () => {
    const onlyMalformed = `Texto curto com fence sem linguagem:\n\`\`\`\nmarkdown\n1. item\n2. item\n\`\`\``;
    expect(detectCanvas(onlyMalformed)).toBeNull();
  });
});
