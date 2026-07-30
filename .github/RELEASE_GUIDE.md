# 🚀 Guia de Release

Instruções para preparar e publicar releases do ModelHub.

## 📋 Checklist Pré-Release

### 1. Código

- [ ] Todos os testes passando (`pnpm test`)
- [ ] Sem erros de lint (`pnpm lint`)
- [ ] Sem erros de tipo (`pnpm typecheck`)
- [ ] Build funciona (`pnpm build`)
- [ ] Sem vulnerabilidades (`pnpm audit`)

### 2. Documentação

- [ ] README.md atualizado
- [ ] CHANGELOG.md atualizado
- [ ] API docs atualizadas
- [ ] Exemplos funcionando
- [ ] URLs corretas (repositório atus7/modelhub)

### 3. Testes

- [ ] Instalação limpa funciona
- [ ] Deploy Vercel funciona
- [ ] Docker build funciona
- [ ] Migrações funcionam
- [ ] API endpoints funcionam

## 🔢 Versionamento

Seguimos [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (1.x.0): Novas features (compatível)
- **PATCH** (1.0.x): Bug fixes

### Exemplos

```
1.0.0 → 1.0.1  # Bug fix
1.0.1 → 1.1.0  # Nova feature
1.1.0 → 2.0.0  # Breaking change
```

## 📝 Processo de Release

### 1. Atualizar CHANGELOG.md

```markdown
## [1.1.0] - 2026-04-20

### Added
- Nova feature X
- Suporte para Y

### Changed
- Melhorado Z

### Fixed
- Corrigido bug A
- Corrigido bug B

### Security
- Atualizada dependência vulnerável
```

### 2. Atualizar package.json

```bash
# Atualizar versão
npm version minor  # ou major/patch

# Isso cria um commit e tag automaticamente
```

### 3. Push com Tags

```bash
git push origin main
git push origin --tags
```

### 4. GitHub Release

O workflow `.github/workflows/release.yml` cria automaticamente:
- GitHub Release
- Release notes
- Docker image

Ou crie manualmente:

1. Vá para [Releases](https://github.com/actus7/modelhub/releases)
2. Clique em "Draft a new release"
3. Escolha a tag (ex: v1.1.0)
4. Título: "ModelHub v1.1.0"
5. Descrição: Copie do CHANGELOG.md
6. Clique em "Publish release"

## 🐳 Docker Release

### Build e Push Manual

```bash
# Build
docker build -t actus7/modelhub:1.1.0 .
docker build -t actus7/modelhub:latest .

# Push
docker push actus7/modelhub:1.1.0
docker push actus7/modelhub:latest
```

### Automático

O workflow de release faz isso automaticamente quando você cria uma tag.

## 📢 Anúncio

### 1. GitHub

- [ ] Publicar release
- [ ] Atualizar README se necessário
- [ ] Fechar issues resolvidas

### 2. Redes Sociais

**Twitter/X:**
```
🚀 ModelHub v1.1.0 está disponível!

✨ Novidades:
- Feature X
- Feature Y
- Bug fixes

📦 Instale: npm install modelhub@latest
📖 Docs: https://github.com/actus7/modelhub

#OpenSource #AI #LLM
```

**LinkedIn:**
```
Estou feliz em anunciar o lançamento do ModelHub v1.1.0! 🎉

ModelHub é uma plataforma open-source que unifica o acesso a múltiplos 
provedores de IA através de uma única API compatível com OpenAI.

Novidades nesta versão:
✨ Feature X
✨ Feature Y
🐛 Diversos bug fixes

Confira em: https://github.com/actus7/modelhub

#OpenSource #AI #MachineLearning #LLM
```

### 3. Comunidades

**Reddit:**
- r/opensource
- r/programming
- r/MachineLearning
- r/artificial

**Dev.to:**
```markdown
---
title: ModelHub v1.1.0 Released
published: true
tags: opensource, ai, typescript, nextjs
---

# ModelHub v1.1.0 Released

[Conteúdo do release]
```

**Hacker News:**
- Título: "ModelHub v1.1.0 – Open-source unified AI gateway"
- URL: https://github.com/actus7/modelhub

### 4. Discord/Slack

```
@everyone 🎉

ModelHub v1.1.0 está disponível!

**Novidades:**
- Feature X
- Feature Y

**Instalação:**
```bash
git pull origin main
pnpm install
pnpm prisma:migrate
pnpm build
```

**Changelog completo:** https://github.com/actus7/modelhub/releases/tag/v1.1.0
```

## 🔄 Hotfix Release

Para correções urgentes:

### 1. Criar Branch

```bash
git checkout -b hotfix/1.0.1 v1.0.0
```

### 2. Fazer Correção

```bash
# Corrigir bug
git add .
git commit -m "fix: correção urgente"
```

### 3. Atualizar Versão

```bash
npm version patch
```

### 4. Merge e Release

```bash
git checkout main
git merge hotfix/1.0.1
git push origin main --tags
```

## 📊 Pós-Release

### 1. Monitorar

- [ ] Issues novas
- [ ] Feedback da comunidade
- [ ] Métricas de download
- [ ] Erros reportados

### 2. Documentar

- [ ] Atualizar roadmap
- [ ] Adicionar ao CHANGELOG
- [ ] Atualizar docs se necessário

### 3. Comunicar

- [ ] Responder feedback
- [ ] Agradecer contribuidores
- [ ] Planejar próxima versão

## 🎯 Release Checklist Completo

### Pré-Release

- [ ] Código revisado
- [ ] Testes passando
- [ ] Documentação atualizada
- [ ] CHANGELOG atualizado
- [ ] Versão atualizada
- [ ] Branch main atualizada

### Release

- [ ] Tag criada
- [ ] GitHub Release publicado
- [ ] Docker image publicado
- [ ] NPM package publicado (se aplicável)

### Pós-Release

- [ ] Anúncio no Twitter
- [ ] Anúncio no LinkedIn
- [ ] Post no Dev.to
- [ ] Post no Reddit
- [ ] Mensagem no Discord
- [ ] Email para usuários (se aplicável)

### Monitoramento

- [ ] Issues monitoradas
- [ ] Feedback coletado
- [ ] Métricas analisadas
- [ ] Próxima versão planejada

## 🚨 Rollback

Se algo der errado:

### 1. Reverter Tag

```bash
git tag -d v1.1.0
git push origin :refs/tags/v1.1.0
```

### 2. Reverter Commits

```bash
git revert HEAD
git push origin main
```

### 3. Comunicar

- Atualizar GitHub Release
- Avisar comunidade
- Explicar o problema
- Informar quando será corrigido

## 📚 Recursos

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Docker Hub](https://hub.docker.com/)

## 💡 Dicas

### Timing

- **Major releases**: Anuncie com antecedência
- **Minor releases**: A cada 2-3 meses
- **Patch releases**: Quando necessário
- **Hotfixes**: Imediatamente

### Comunicação

- Seja claro sobre breaking changes
- Forneça migration guides
- Agradeça contribuidores
- Peça feedback

### Qualidade

- Nunca lance com testes falhando
- Sempre teste a instalação limpa
- Documente todas as mudanças
- Mantenha CHANGELOG atualizado

## 🎉 Exemplo de Release Notes

```markdown
# ModelHub v1.1.0

## 🎉 Highlights

- **Nova Feature X**: Descrição da feature
- **Melhorado Y**: Descrição da melhoria
- **Performance**: 50% mais rápido em Z

## ✨ New Features

- Feature A (#123) @contributor1
- Feature B (#124) @contributor2

## 🐛 Bug Fixes

- Fixed bug X (#125) @contributor3
- Fixed bug Y (#126) @contributor4

## 📚 Documentation

- Updated API docs
- Added new examples
- Improved README

## 🔧 Internal

- Refactored module Z
- Updated dependencies
- Improved CI/CD

## 💔 Breaking Changes

**None** - This is a backward compatible release.

## 📦 Installation

```bash
git clone https://github.com/actus7/modelhub.git
cd modelhub
pnpm install
```

## 🙏 Contributors

Thanks to all contributors who made this release possible:
- @contributor1
- @contributor2
- @contributor3

## 📖 Full Changelog

https://github.com/actus7/modelhub/compare/v1.0.0...v1.1.0
```

---

**Happy Releasing! 🚀**
