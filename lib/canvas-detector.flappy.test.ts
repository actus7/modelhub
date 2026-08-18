import { describe, expect, it } from "vitest";
import { buildDisplayText, detectCanvas } from "./canvas-detector";

// Reprodução fiel da resposta real de 15:30 (mistral/ministral-8b):
// fence ```html GRANDE contendo template literals com backticks no meio das
// linhas (`${birdY}px`), CSS com #ids e estrutura HTML completa.
const flappyHtml = [
  "<!DOCTYPE html>",
  '<html lang="pt-BR">',
  "<head>",
  '    <meta charset="UTF-8">',
  "    <style>",
  "        body {",
  "            margin: 0;",
  "            display: flex;",
  "            height: 100vh;",
  "            background-color: #f0f0f0;",
  "            overflow: hidden;",
  "        }",
  "        #game-container {",
  "            position: relative;",
  "            width: 500px;",
  "            height: 600px;",
  "            overflow: hidden;",
  "        }",
  "        #score-display {",
  "            position: absolute;",
  "            top: 10px;",
  "            font-size: 24px;",
  "            font-weight: bold;",
  "        }",
  "        #bird {",
  "            position: absolute;",
  "            width: 50px;",
  "            height: 50px;",
  "        }",
  "        #pipe {",
  "            position: absolute;",
  "            width: 60px;",
  "            background-color: #4CAF50;",
  "        }",
  "    </style>",
  "</head>",
  "<body>",
  '    <div id="game-container">',
  '        <div id="score-display">Pontuação: 0</div>',
  '        <canvas id="canvas" width="500" height="600"></canvas>',
  '        <div id="bird"></div>',
  "    </div>",
  "    <script>",
  "        const canvas = document.getElementById('canvas');",
  "        const bird = document.getElementById('bird');",
  "        let birdY = 300;",
  "        let birdVelocity = 0;",
  "        let gravity = 0.5;",
  "        let jumpForce = -10;",
  "        let score = 0;",
  "        let gameRunning = true;",
  "        let pipes = [];",
  "        function initGame() {",
  "            bird.style.left = '50px';",
  "            bird.style.top = `${birdY}px`;",
  "            scoreDisplay.textContent = `Pontuação: ${score}`;",
  "            pipes = [];",
  "            requestAnimationFrame(gameLoop);",
  "        }",
  "        function gameLoop(timestamp) {",
  "            if (!gameRunning) return;",
  "            birdVelocity += gravity;",
  "            birdY += birdVelocity;",
  "            bird.style.top = `${birdY}px`;",
  "            if (birdY > 600 || birdY < 0) {",
  "                gameOver();",
  "                return;",
  "            }",
  "            updatePipes();",
  "            gameLoopId = requestAnimationFrame(gameLoop);",
  "        }",
  "        function addPipe() {",
  "            const pipeHeight = Math.floor(Math.random() * 200) + 100;",
  "            const pipeTop = document.createElement('div');",
  "            pipeTop.style.height = `${pipeHeight}px`;",
  "            pipeTop.style.top = '0';",
  "            pipes.push({ top: pipeTop, x: 500, passed: false });",
  "        }",
  "        function updatePipes() {",
  "            pipes.forEach(pipe => {",
  "                pipe.x -= 2;",
  "                pipe.top.style.left = `${pipe.x}px`;",
  "            });",
  "        }",
  "        initGame();",
  "    <\/script>",
  "</body>",
  "</html>",
].join("\n");

const realResponse = [
  "Aqui está um clone simplificado do estilo de FapBird (jogo de clicar em pássaros) implementado como um canvas interativo usando HTML, CSS e JavaScript. Este exemplo é autocontido e pode ser inserido diretamente em um painel Canvas do ModelHub.",
  "",
  "```html",
  flappyHtml,
  "```",
  "",
  "Características do Clone:",
  "Controles: Clique no canvas ou pressione Espaço para fazer o pássaro subir.",
  "Nota: Este código é autocontido e não requer bibliotecas externas.",
].join("\n");

describe("reprodução: resposta flappy bird de 15:30", () => {
  it("detecta o fence html grande mesmo com template literals contendo backticks", () => {
    const suggestion = detectCanvas(realResponse, { explicitIntent: true });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.kind).toBe("html");
  });

  it("detecta também SEM intenção explícita (fence > 800 chars)", () => {
    const suggestion = detectCanvas(realResponse);
    expect(suggestion?.kind).toBe("html");
  });

  it("display text remove o html e mantém a conclusão", () => {
    const suggestion = detectCanvas(realResponse, { explicitIntent: true })!;
    const display = buildDisplayText(realResponse, suggestion);
    expect(display).not.toContain("<!DOCTYPE");
    expect(display).toContain("Características do Clone");
  });

  it("fence html com indentação de até 3 espaços também é detectado (tolerância CommonMark)", () => {
    const indented = `Intro:\n\n   \`\`\`html\n${"<p>x</p>".repeat(30)}\n   \`\`\`\n\nFim.`;
    expect(detectCanvas(indented, { explicitIntent: true })?.kind).toBe("html");
  });
});
