# Plano: Canvas + Projetos no ModelHub (spec congelada v2)

> Este documento é a fonte única de verdade para a implementação.
> Ajustes da v2 (validação contra codebase): detecção de canvas é **client-side**;
> injeção de contexto em **dois** pontos (server + browser); `/projects` entra no
> matcher do `proxy.ts`; share segue o padrão existente `/share/[token]`;
> transpile React é **client-side** (Babel standalone + iframe), não esbuild-wasm.

## Decisões congeladas

- Canvas nasce **dentro da conversa**, auto-detectado durante o stream (client-side).
- Kinds: `markdown | code | html | react | mermaid`.
- Versionamento: toda mudança de conteúdo cria nova `CanvasVersion` (auto-version).
- Fixar ("pin") canvas em projeto = **snapshot imutável** (`ProjectArtifact` + versões).
  Editar o canvas NÃO altera o artefato; ação explícita "atualizar do canvas" cria nova versão.
- Projetos: flat (1 nível). Deletar projeto **deleta** suas conversas (Cascade — paridade Claude).
- Share de canvas/artefato via token na URL pública existente `/share/[token]` (read-only).
- Instruções do projeto + arquivos de conhecimento são injetados no system context de TODAS
  as conversas do projeto (server para gateway; client para providers browser-session).
- Iteração com IA (MVP): com o painel de canvas aberto, o request inclui o conteúdo atual do
  canvas como contexto; se o detector disparar de novo, o canvas ATIVO recebe nova versão
  (em vez de criar outro).
- Gaps declarados (não-MVP): RAG real (embeddings) para arquivos de projeto; "remix" público.

## Modelo de dados (Prisma)

```prisma
model Project {
  id           String   @id @default(cuid())
  userId       String
  name         String
  description  String?
  instructions String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user          User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversations Conversation[]
  files         ProjectFile[]
  artifacts     ProjectArtifact[]

  @@index([userId, updatedAt])
}

model ProjectFile {
  id            String   @id @default(cuid())
  projectId     String
  fileName      String
  mimeType      String
  byteSize      Int
  blob          Bytes
  extractedText String?
  createdAt     DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model ProjectArtifact {
  id                   String   @id @default(cuid())
  projectId            String
  sourceConversationId String?
  sourceCanvasId       String?
  title                String
  kind                 String   // CanvasKind
  language             String?
  currentVersion       Int      @default(1)
  shareToken           String?  @unique
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  project       Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  conversation  Conversation?     @relation("ArtifactSourceConversation", fields: [sourceConversationId], references: [id], onDelete: SetNull)
  sourceCanvas  Canvas?           @relation("ArtifactSourceCanvas", fields: [sourceCanvasId], references: [id], onDelete: SetNull)
  versions      ArtifactVersion[]

  @@index([projectId, updatedAt])
}

model ArtifactVersion {
  id         String   @id @default(cuid())
  artifactId String
  version    Int
  content    String
  createdAt  DateTime @default(now())

  artifact ProjectArtifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)

  @@unique([artifactId, version])
}

model Canvas {
  id             String   @id @default(cuid())
  conversationId String
  title          String
  kind           String   // CanvasKind
  language       String?
  content        String
  activeVersion  Int      @default(1)
  shareToken     String?  @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  conversation    Conversation       @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  versions        CanvasVersion[]
  pinnedArtifacts ProjectArtifact[]  @relation("ArtifactSourceCanvas")

  @@index([conversationId, updatedAt])
}

model CanvasVersion {
  id        String   @id @default(cuid())
  canvasId  String
  version   Int
  kind      String
  language  String?
  content   String
  createdAt DateTime @default(now())

  canvas Canvas @relation(fields: [canvasId], references: [id], onDelete: Cascade)

  @@unique([canvasId, version])
}
```

`Conversation` ganha:
```prisma
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
```

## Contratos (lib/contracts.ts — CONGELADO, não editar durante as lanes)

Tipos `CanvasKind`, `CanvasSummary`, `CanvasDetail`, `ProjectSummary`, `ProjectDetail`,
`ProjectFileSummary`, `ProjectArtifactSummary`, `ProjectArtifactDetail`,
`ProjectContextPayload` + `MODELHUB_PROJECT_HEADER = "x-modelhub-project-id"`.

## Endpoints

### Conversations (extensões em server/routes/conversations.ts — aditivo)
- `POST /conversations` body aceita `projectId?` (valida posse do projeto).
- `PATCH /conversations/:id` body aceita `projectId?: string | null` (mover/retirar).
- `GET /conversations/:id/canvases` → `{ canvases: CanvasSummary[] }`
- `POST /conversations/:id/canvases` `{ title?, kind, language?, content }` → `201 { canvas: CanvasDetail }`

### Canvas (server/routes/canvas.ts, basePath `/canvas`, auth igual conversations)
- `GET /canvas/:id` → `{ canvas: CanvasDetail }` (content = versão ativa; versions = índice)
- `PATCH /canvas/:id` `{ title?, kind?, language?, content? }` → se `content` mudou, cria
  `CanvasVersion` nova (`version = max+1`) e atualiza `activeVersion`. Retorna CanvasDetail.
- `DELETE /canvas/:id`
- `GET /canvas/:id/versions` → `{ versions: [{version, kind, language, createdAt}] }`
- `GET /canvas/:id/versions/:version` → `{ version: {..., content} }`
- `POST /canvas/:id/versions/:version/restore` → conteúdo da versão vira versão nova (nova = ativa)
- `POST /canvas/:id/share` → `{ shareToken }` (idempotente); `DELETE /canvas/:id/share`
- `POST /canvas/:id/pin` `{ projectId }` → cria `ProjectArtifact` (+`ArtifactVersion` v1,
  snapshot do content atual); se já existe artefato com `sourceCanvasId = id` no projeto,
  retorna conflito `409 { artifactId }`. → `201 { artifact: ProjectArtifactDetail }`
- Ownership: resolver canvas → conversation → `userId` (findFirst com userId).

### Projects (server/routes/projects.ts, basePath `/projects`, auth igual conversations)
- `GET /projects` → `{ projects: ProjectSummary[] }` (com counts)
- `POST /projects` `{ name (1..100), description?, instructions? }` → `201`
- `GET /projects/:id` → `{ project: ProjectDetail }`
- `PATCH /projects/:id` `{ name?, description?, instructions? }`
- `DELETE /projects/:id` (cascata: conversas, arquivos, artefatos)
- `GET /projects/:id/conversations` → conversas do projeto (shape do GET /conversations)
- `POST /projects/:id/files` (multipart `file`; mesma validação de
  `server/lib/conversation-attachments.ts` — tipo, tamanho máx, extração de texto p/ docs)
  → `201 { file: ProjectFileSummary }`
- `GET /projects/:id/files` → `{ files: ProjectFileSummary[] }`
- `GET /projects/:id/files/:fileId/content` → binário autenticado (inline)
- `DELETE /projects/:id/files/:fileId`
- `GET /projects/:id/artifacts` → `{ artifacts: ProjectArtifactSummary[] }`
- `GET /projects/:id/artifacts/:artifactId` → `{ artifact: ProjectArtifactDetail }`
- `DELETE /projects/:id/artifacts/:artifactId`
- `POST /projects/:id/artifacts/:artifactId/refresh` `{ canvasId }` → nova
  `ArtifactVersion` snapshot do canvas atual (o canvas deve ter `sourceCanvasId` = este
  artefato? Não — o artefato deve ter `sourceCanvasId === canvasId`). `409` se não bater.
- `GET /projects/:id/context` → `{ ProjectContextPayload }` — instructions +
  `knowledge[]` (fileName + texto extraído, cap por arquivo 20k chars, total 60k chars).

### Share público (app/api/share/[token]/route.ts — estender, manter runtime nodejs)
`GET /api/share/:token` resolve na ordem: conversation.shareToken → canvas.shareToken →
artifact.shareToken (versão atual). Sempre inclui `type`:
- `{ type: "conversation", conversation: {...} }` (shape atual + type)
- `{ type: "canvas", canvas: { title, kind, language, content, createdAt } }`
- `{ type: "artifact", artifact: { title, kind, language, content, updatedAt } }`

### Message part "canvas" (lib/chat-parts.ts — extensão ADITIVA)
Novo part: `{ type: "canvas", canvasId, title, kind }`. `parseSingleMessagePart` aceita;
`hydrateMessageParts` repassa sem transformação. Renderização no chat = card clicável.

## Detecção de canvas (client-side — lib/canvas-detector.ts)

Acumulador incremental sobre `onTextDelta`:
- Fenced block com linguagem `mermaid` (qualquer tamanho ≥ 40 chars) → kind `mermaid`.
- Fenced block ≥ 20 linhas OU ≥ 800 chars, linguagem `html` → `html`; `tsx|jsx` → `react`;
  outra linguagem → `code`.
- Mensagem total (sem fences elegíveis) ≥ 1500 chars → `markdown` (conteúdo = mensagem toda).
- Título heurístico: primeira heading `# ` ou 1ª linha não-vazia truncada a 60 chars.
- Emite UMA sugestão por stream (a mais forte; mermaid > react/html > code > markdown).
- Se já existe canvas ATIVO na conversa (painel aberto): o disparo gera **update** (PATCH nova
  versão) do canvas ativo, não um canvas novo.
- Bubble da mensagem: quando canvas é criado a partir de fence, o bubble mostra só o texto
  fora do fence + card do canvas (part `canvas`). Caso `markdown`, bubble mostra 1º parágrafo + card.

## Iteração com IA (MVP)

Com o painel do canvas aberto, o request do chat inclui, antes da mensagem do usuário,
uma mensagem de contexto (role user, prefixada): `"[canvas ativo: <title>]\n<content>"`
(cap 20k chars). Toggle na toolbar (default ligado). Providers browser-session (Puter)
usam o mesmo mecanismo client-side.

## Injeção de contexto de projeto (wave 2)

- Server: em `server/lib/provider-core.ts` (`buildUserContextMessage`), ler header
  `x-modelhub-project-id`; se presente e do usuário, anexar `Project instructions:\n...`
  e o knowledge (mesmos caps de `/projects/:id/context`) ao system context existente.
- Browser: em `lib/browser-chat-providers.ts` (`buildBrowserSystemPrompt`), quando o chat
  informar `projectId`, buscar `/projects/:id/context` e anexar igual.
- Chat envia o header em `/v1/chat/completions` e nas rotas `/:provider/api/chat`.

## Preview (client-side)

- `html`: iframe sandboxed (`sandbox="allow-scripts"`) com srcdoc.
- `react`: pai transpila com `@babel/standalone` (`presets: ["react", "typescript"]`);
  iframe com React+ReactDOM UMD (CDN esm.sh/unpkg) + código transpilado. Erros → overlay no preview.
- `mermaid`: `import("mermaid")` dinâmico, render SVG no container (sem iframe), tema dark-aware.
- `markdown`: `MarkdownRenderer` existente.
- `code`: CodeMirror read-only com highlight da linguagem.

## UX (resumo)

- Desktop: chat | canvas split-pane redimensionável; canvas abre automaticamente durante o
  stream e atualiza ao vivo. Mobile: canvas como overlay/sheet fullscreen.
- Toolbar: título editável, kind badge, copiar, baixar, versões (dialog: listar, ver, restaurar),
  compartilhar (gera/copiar link `/share/<token>`), fixar em projeto (picker), toggle contexto IA.
- Sidebar do chat: seção "Projetos" (lista + ver todos → `/projects`).
- `/projects`: grid de cards + criar (nome, descrição, instruções). `/projects/[id]`:
  cabeçalho editável + seções Conversas / Arquivos (upload, download, delete) / Artefatos
  (abrir, versões, atualizar do canvas, compartilhar, excluir). "Nova conversa no projeto"
  → `/chat?project=<id>&new=1`.
- Strings de UI em pt-BR. Nenhum dep novo além dos já instalados.

## Dependências (já instaladas no wave 0 — NÃO modificar package.json nas lanes)

`@uiw/react-codemirror`, `@codemirror/lang-markdown|javascript|html|css`, `mermaid`,
`@babel/standalone` (+ `-D @types/babel__standalone`).

## Ownership de escrita por lane (estrito)

- **fixer-backend**: `prisma/schema.prisma`, `server/routes/projects.ts`,
  `server/routes/canvas.ts`, `server/routes/conversations.ts` (aditivo),
  `server/app.ts` (mount), `server/tests/projects-routes.test.ts`,
  `server/tests/canvas-routes.test.ts`, `lib/chat-parts.ts` (aditivo),
  `app/api/share/[token]/route.ts`. Rodar `pnpm prisma:generate` (migration best-effort).
- **designer-canvas**: `components/canvas/**`, `lib/canvas-detector.ts`,
  `lib/canvas-client.ts`, `components/chat/chat-page.tsx`, `app/share/[token]/page.tsx`.
- **designer-projects**: `app/(app)/projects/**`, `components/projects/**`,
  `components/chat/chat-history-sidebar.tsx`.
- Congelados (leitura apenas): `lib/contracts.ts`, `docs/canvas-projects-plan.md`,
  `package.json`, `proxy.ts` (já atualizado com `/projects/:path*`).

## Fases

1. Wave 1 (paralelo): backend + canvas UI + projects UI.
2. Wave 2: injeção de contexto (provider-core + browser-chat-providers) + wiring
   `?project=` no chat (criar conversa no projeto, header, seletor no composer).
3. Wave 3: verificação integrada (lint, typecheck, test, build) + correções.
4. Pós-MVP (fora de escopo agora): RAG p/ arquivos, remix público, export PDF/PNG.
