# Auditoria de prontidão para produção — 17 e 18 de agosto de 2026

## Escopo

Revisão independente dos commits de `0879874` (17 de agosto) a `c7ff2e2`
(18 de agosto), com foco em CI, dependências, scripts, build/deploy,
configuração e documentação. As correções desta auditoria ficaram restritas a
`.github/**`, `package.json`, `pnpm-lock.yaml`, `docs/**`, `README.md`,
`README_EN.md`, `CLAUDE.md` e `next-env.d.ts`. Uma etapa complementar para os
bloqueadores operacionais foi autorizada em `Dockerfile`, `.dockerignore`,
`docker-compose.yml`, `.github/workflows/release.yml`, `CHANGELOG.md` e neste
relatório.

## Resultado executivo

O código auditado passou inicialmente em testes, lint, typecheck e build de
produção. O audit de dependências encontrou 12 advisories (5 high, 4 moderate e
3 low) no grafo completo e 3 advisories (1 moderate e 2 low) no grafo de
produção; os overrides e o lockfile foram atualizados e ambos os audits agora
retornam `No known vulnerabilities found`.

A prontidão final permanece bloqueada por uma validação dinâmica dependente do
ambiente:

1. O `Dockerfile` e o Compose foram validados estaticamente, mas o host da
   auditoria não possui o cliente/daemon Docker. Ainda é necessário executar o
   build real da imagem antes de promover uma tag.

O erro de runtime originalmente observado em `app/layout.tsx:58` foi corrigido
em uma etapa posterior, autorizada separadamente: o `<script>` bruto foi trocado
por `next/script`, com `id` e `strategy="beforeInteractive"`. O cache `.next` foi
removido com o servidor parado, o `next dev` foi reiniciado e a página foi
validada em um navegador real sem os erros originais de script ou chunks.

## Correções aplicadas

- Atualizados overrides transitivos para versões corrigidas de `@babel/core`,
  `@hono/node-server`, `body-parser`, `brace-expansion`, `esbuild`, `ip-address`,
  `js-yaml` e `ua-parser-js`.
- Regenerado `pnpm-lock.yaml` com `pnpm install --lockfile-only` e confirmado com
  `pnpm install --frozen-lockfile`.
- Atualizados README em português e inglês para Next.js 16.3 e para documentar
  Canvas versionado, Projetos, a rota `/projects` e os novos modelos de dados.
- Adicionado `Dockerfile` multi-stage com Node.js 22, pnpm 10.33.0, geração
  explícita do Prisma 7, dependências de produção isoladas e processo final sob
  o usuário não-root `node`.
- Instalado Chromium apenas no estágio final e configurado
  `PUPPETEER_EXECUTABLE_PATH`, preservando o fallback local padrão do Duck.ai.
  O sandbox não é desativado por padrão; ambientes incompatíveis podem optar
  explicitamente pelo flag ou por um browser remoto.
- Reforçado `.dockerignore` para excluir todos os arquivos `.env*`, credenciais
  de registries, chaves privadas e artefatos locais de `.playwright-cli` do
  contexto de build.
- Atualizados Compose e workflow de release para healthcheck sem dependência de
  utilitário do sistema, remoção de valores que pareciam segredos no build,
  extração correta da versão sem o prefixo `v` e Docker Build Push Action v6.
- Registradas no `CHANGELOG.md` as mudanças de produto e segurança de 17 e 18 de
  agosto.

## Evidência de validação

### Baseline antes das mudanças concorrentes

- `pnpm test`: 52 arquivos passaram, 1 pulado; 418 testes passaram, 1 pulado.
- `pnpm typecheck`: sem erros.
- `pnpm lint`: passou.
- `pnpm build`: passou em 10,6 s; 32 páginas estáticas geradas e as novas rotas
  `/projects` e `/projects/[id]` foram incluídas.

### Depois das correções de dependências

- `pnpm audit --prod --audit-level=low`: sem vulnerabilidades conhecidas.
- `pnpm audit --audit-level=low`: sem vulnerabilidades conhecidas.
- `pnpm typecheck`: sem erros após o responsável pela mudança concorrente em
  `server/routes/user.ts` adicionar o import ausente de `zod`.
- `pnpm test`: 53 arquivos passaram e 1 foi pulado; 428 testes passaram e 1 foi
  pulado. Uma falha transitória no novo teste de Canvas foi corrigida pelo
  responsável durante a auditoria e a repetição ficou verde.
- `pnpm lint`: passou na repetição final.
- A repetição final de build ficou inconclusiva: um processo concorrente de
  desenvolvimento compartilhava `.next` e o comando não encerrou. O build
  inicial havia passado.

### Validação do empacotamento Docker

- `pnpm prisma:generate`: passou; no build da imagem o mesmo comando roda depois
  de `.env*` ser excluído do contexto, usando o fallback não secreto de
  `prisma.config.ts`.
- `pnpm build`: passou em 22,6 s no checkout local. Esse checkout carregou o
  `.env.local`; portanto, o build sem arquivos de ambiente ainda depende da
  validação dinâmica da imagem.
- Dockerfile: validado estaticamente quanto a stages, cópias, geração Prisma,
  build Next.js, dependências de runtime, Chromium/Puppeteer e `USER node`.
- YAML de `docker-compose.yml` e `.github/workflows/release.yml`: sintaxe
  validada estaticamente.
- `docker build` e `docker compose config`: não executados porque o executável
  `docker` não está instalado neste host.

## CI, deploy e configuração

- O CI cobre lint, typecheck, testes, audit de produção e build em pushes/PRs
  para `main` e `develop`.
- O Dependency Review só é efetivo quando a variável
  `ENABLE_DEPENDENCY_REVIEW=true`; caso contrário, o workflow passa executando
  apenas um job de aviso.
- As GitHub Actions usam tags mutáveis (`@v7`, `@v6`, `@v5` etc.), não SHAs. Isso
  mantém risco residual de supply chain apesar das versões major fixadas.
- O build da Vercel executa `prisma migrate deploy` em preview/produção. Deploys
  por VPS/Docker precisam aplicar explicitamente as migrações de 17 e 18 de
  agosto antes de iniciar a nova versão.
- Após a atualização do lockfile, um servidor `next dev` já aberto pode apontar
  para chunks com o hash antigo de peers do Next/Babel. Reinicie o servidor de
  desenvolvimento e faça hard reload; não reutilize o conteúdo antigo de
  `.next/dev`.

## Riscos residuais

- A instalação ainda avisa sobre 22 subdependências deprecated. Elas não têm
  advisories conhecidos no audit atual, mas devem ser removidas por upgrades dos
  pacotes diretos que as trazem.
- O plano técnico de Canvas/Projetos documenta APIs internas, mas a documentação
  pública de API ainda não descreve esses endpoints autenticados.
- A imagem final usa a tag base mutável `node:22-bookworm-slim`; o pipeline deve
  registrar o digest produzido e considerar fixar o digest após a primeira
  validação dinâmica.
- O Chromium aumenta o tamanho e a superfície de atualização da imagem. A
  imagem deve ser reconstruída regularmente para receber correções do pacote
  Debian; não habilite `DUCKAI_PUPPETEER_NO_SANDBOX=true` sem uma avaliação do
  isolamento oferecido pelo ambiente de containers.
- O build Docker precisa ser executado em um host com daemon antes de promover
  a versão.
