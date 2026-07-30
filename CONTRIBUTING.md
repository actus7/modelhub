# 🤝 Guia de Contribuição

Obrigado por considerar contribuir com o ModelHub! Este documento fornece diretrizes para contribuir com o projeto.

## 📋 Índice

- [Código de Conduta](#código-de-conduta)
- [Como Posso Contribuir?](#como-posso-contribuir)
- [Configuração do Ambiente](#configuração-do-ambiente)
- [Processo de Desenvolvimento](#processo-de-desenvolvimento)
- [Padrões de Código](#padrões-de-código)
- [Commits e Pull Requests](#commits-e-pull-requests)
- [Reportar Bugs](#reportar-bugs)
- [Sugerir Melhorias](#sugerir-melhorias)

## 📜 Código de Conduta

Este projeto adota o Contributor Covenant. Ao participar, você concorda em seguir o [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## 🎯 Como Posso Contribuir?

### Tipos de Contribuição

- 🐛 **Reportar bugs** - Encontrou um problema? Abra uma issue
- 💡 **Sugerir features** - Tem uma ideia? Compartilhe conosco
- 📝 **Melhorar documentação** - Docs nunca são demais
- 🔧 **Corrigir bugs** - Escolha uma issue e resolva
- ✨ **Implementar features** - Adicione novas funcionalidades
- 🧪 **Escrever testes** - Aumente a cobertura de testes
- 🌍 **Traduzir** - Ajude a internacionalizar o projeto

## 🛠️ Configuração do Ambiente

### Pré-requisitos

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Git
- Conta no Neon (para banco de dados)

### Setup Local

1. **Fork o repositório**
   ```bash
   # Clique em "Fork" no GitHub
   ```

2. **Clone seu fork**
   ```bash
   git clone https://github.com/SEU-USUARIO/modelhub.git
   cd modelhub
   ```

3. **Adicione o repositório original como upstream**
   ```bash
   git remote add upstream https://github.com/actus7/modelhub.git
   ```

4. **Instale as dependências**
   ```bash
   pnpm install
   ```

5. **Configure as variáveis de ambiente**
   ```bash
   cp .env.example .env
   # Edite .env com suas credenciais
   ```

6. **Execute as migrações**
   ```bash
   pnpm prisma:migrate
   ```

7. **Inicie o servidor de desenvolvimento**
   ```bash
   pnpm dev
   ```

## 🔄 Processo de Desenvolvimento

### 1. Escolha uma Issue

- Procure issues com labels `good first issue` ou `help wanted`
- Comente na issue que você quer trabalhar nela
- Aguarde aprovação de um maintainer

### 2. Crie uma Branch

```bash
# Atualize sua main
git checkout main
git pull upstream main

# Crie uma branch descritiva
git checkout -b feature/nome-da-feature
# ou
git checkout -b fix/nome-do-bug
```

### 3. Faça suas Mudanças

- Escreva código limpo e bem documentado
- Siga os padrões de código do projeto
- Adicione testes quando aplicável
- Atualize a documentação se necessário

### 4. Teste suas Mudanças

```bash
# Execute os testes
pnpm test

# Verifique o linting
pnpm lint

# Verifique os tipos
pnpm typecheck

# Teste manualmente no navegador
pnpm dev
```

### 5. Commit suas Mudanças

```bash
git add .
git commit -m "tipo: descrição curta"
```

### 6. Push e Abra um PR

```bash
git push origin feature/nome-da-feature
```

Abra um Pull Request no GitHub seguindo o template.

## 📏 Padrões de Código

### TypeScript

- Use TypeScript para todo código novo
- Evite `any`, prefira tipos específicos
- Use interfaces para objetos públicos
- Use types para unions e intersections

```typescript
// ✅ Bom
interface User {
  id: string;
  name: string;
  email: string;
}

// ❌ Evite
const user: any = { ... };
```

### React/Next.js

- Use componentes funcionais com hooks
- Prefira Server Components quando possível
- Use `"use client"` apenas quando necessário
- Extraia lógica complexa para hooks customizados

```typescript
// ✅ Bom
export default function MyComponent({ data }: Props) {
  return <div>{data.title}</div>;
}

// ❌ Evite
export default function MyComponent(props: any) {
  return <div>{props.data.title}</div>;
}
```

### Estilo de Código

- Use 2 espaços para indentação
- Use aspas simples para strings
- Use ponto e vírgula
- Máximo 100 caracteres por linha
- Use Prettier para formatação automática

```bash
# Formate o código
pnpm prettier --write .
```

### Nomenclatura

- **Arquivos**: kebab-case (`user-profile.tsx`)
- **Componentes**: PascalCase (`UserProfile`)
- **Funções**: camelCase (`getUserData`)
- **Constantes**: UPPER_SNAKE_CASE (`API_BASE_URL`)
- **Tipos/Interfaces**: PascalCase (`UserData`)

### Estrutura de Arquivos

```
feature/
├── components/
│   ├── feature-component.tsx
│   └── feature-component.test.tsx
├── hooks/
│   └── use-feature.ts
├── lib/
│   └── feature-utils.ts
└── types/
    └── feature.types.ts
```

## 📝 Commits e Pull Requests

### Mensagens de Commit

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
tipo(escopo): descrição curta

Descrição mais detalhada (opcional)

Closes #123
```

**Tipos:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `style`: Formatação (não afeta código)
- `refactor`: Refatoração
- `test`: Testes
- `chore`: Manutenção

**Exemplos:**
```bash
feat(chat): adiciona suporte a anexos de imagem
fix(auth): corrige erro de login com Google
docs(readme): atualiza instruções de instalação
test(api): adiciona testes para endpoint de chat
```

### Pull Requests

**Título:** Use o mesmo formato de commits
```
feat(chat): adiciona suporte a anexos de imagem
```

**Descrição:** Use o template fornecido
- Descreva o que foi mudado e por quê
- Referencie issues relacionadas
- Adicione screenshots se aplicável
- Liste breaking changes se houver

**Checklist:**
- [ ] Código segue os padrões do projeto
- [ ] Testes passam localmente
- [ ] Adicionei testes para novas funcionalidades
- [ ] Documentação foi atualizada
- [ ] Não há conflitos com a branch main

## 🐛 Reportar Bugs

### Antes de Reportar

- Verifique se o bug já foi reportado
- Teste na versão mais recente
- Colete informações sobre o ambiente

### Template de Bug Report

```markdown
**Descrição**
Descrição clara do bug.

**Passos para Reproduzir**
1. Vá para '...'
2. Clique em '...'
3. Veja o erro

**Comportamento Esperado**
O que deveria acontecer.

**Comportamento Atual**
O que está acontecendo.

**Screenshots**
Se aplicável.

**Ambiente**
- OS: [e.g. Windows 11]
- Node: [e.g. 22.0.0]
- Browser: [e.g. Chrome 120]
- Version: [e.g. 1.0.0]

**Contexto Adicional**
Qualquer outra informação relevante.
```

## 💡 Sugerir Melhorias

### Template de Feature Request

```markdown
**Problema**
Qual problema esta feature resolve?

**Solução Proposta**
Como você imagina que funcione?

**Alternativas**
Outras soluções que você considerou?

**Contexto Adicional**
Screenshots, mockups, exemplos, etc.
```

## 🧪 Testes

### Escrevendo Testes

```typescript
import { describe, it, expect } from 'vitest';

describe('MyFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Executando Testes

```bash
# Todos os testes
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage
```

## 📚 Recursos

- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React Docs](https://react.dev/)

## ❓ Dúvidas?

- Abra uma [Discussion](https://github.com/actus7/modelhub/discussions)
- Entre no nosso [Discord](https://discord.gg/modelhub)
- Envie um email para dev@modelhub.dev

## 🎉 Obrigado!

Suas contribuições tornam o ModelHub melhor para todos. Obrigado por dedicar seu tempo! 🙏

---

**Happy Coding! 🚀**
