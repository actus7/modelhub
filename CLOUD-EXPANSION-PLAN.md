# Plano de Expansao Cloud — Suporte Oracle OCI

> **Data:** 2026-06-03
> **Status:** Proposta (revisada)
> **Autor:** @actus7

## Sumario Executivo

O ModelHub atualmente oferece deploy cloud do OpenClaw exclusivamente via **Render** (free tier). Este documento propoe a adicao do **Oracle Cloud Infrastructure (OCI)** como segundo provider cloud, aproveitando o **Always Free Tier** da Oracle — que oferece recursos drasticamente superiores ao Render free (4 OCPUs ARM + 24 GB RAM vs 0.1 CPU + 512 MB) e sem cold start.

O OCI e posicionado como **"modo poderoso guiado"**: o ModelHub gerencia toda a infraestrutura (chaves RSA, rede, containers, updates) de forma transparente, enquanto Render continua como "modo simples". O usuario fornece 2 IDs da conta OCI e copia uma chave publica gerada — todo o resto e automatizado. Ha uma etapa manual inevitavel (colar a public key no Console Oracle), mas e guiada passo-a-passo com deep links.

---

## 1. Motivacao

### Limitacoes do Render Free Tier

| Aspecto | Render Free | Impacto |
|---------|------------|---------|
| CPU | 0.1 CPU | Respostas lentas do agente |
| RAM | 512 MB | OOM com plugins habilitados |
| Sleep | Apos 15 min de inatividade | Cold start de 30-60s |
| Banda | 100 GB/mes | Limitado para uso intenso |
| Persistencia | Efemera | Sem estado entre deploys |

### Vantagens do OCI Always Free

| Aspecto | OCI Always Free | Ganho vs Render |
|---------|----------------|-----------------|
| CPU | Ate 4 OCPUs ARM (Ampere A1) | ~40x mais |
| RAM | Ate 24 GB | ~48x mais |
| Sleep | Sem sleep (always-on) | Sem cold start |
| Banda | 10 TB/mes outbound | 100x mais |
| Storage | 200 GB block storage | Persistente |
| Load Balancer | 1 Flexible LB (10 Mbps) gratis | Incluso |

> **Nota sobre permanencia:** O free tier da Oracle nao tem data de expiracao (diferente dos 12 meses de AWS/GCP/Azure). Porem, a Oracle aplica uma **politica de reclamacao de instancias ociosas**: se a utilizacao de CPU ficar abaixo de 20% por 7 dias consecutivos, a instancia pode ser parada. Um agente OpenClaw ativo respondendo requisicoes normalmente nao sera afetado, mas o usuario deve estar ciente. Converter para conta Pay-As-You-Go (sem custo adicional dentro dos limites free) elimina completamente essa restricao.

### Por que OCI e nao outro provider?

- **Free tier mais generoso** do mercado para compute (ARM A1)
- **Sem expiracao** — ao contrario do trial de 12 meses de AWS/GCP/Azure
- **Container Instances** — servico serverless para containers, sem gerenciar VMs
- **SDK TypeScript oficial** (`oci-common`, `oci-containerinstances`, `oci-core`) ativamente mantido (v2.131+)
- **Complementar ao Render** — OCI para workloads pesados, Render para simplicidade

---

## 2. Arquitetura Proposta

### 2.1 Visao Geral

```
+-----------------------------------------------------+
|                    ModelHub App                       |
|                                                      |
|  server/lib/cloud/                                   |
|  +-- driver.ts          (NOVO - CloudProviderDriver) |
|  +-- render.ts          (existente, implementa Driver)|
|  +-- oci.ts             (NOVO, implementa Driver)    |
|                                                      |
|  server/routes/cloud.ts (provider-agnostic via Driver)|
|                                                      |
|  components/dashboard/cloud-section.tsx (expandir)   |
+-------------+------------------------+--------------+
              |                        |
              v                        v
    +-----------------+  +-------------------------+
    |   Render API     |  |    OCI REST API          |
    |  (Bearer token)  |  |  (RSA Signature auth)   |
    +--------+--------+  +----------+--------------+
             |                      |
             v                      v
    +-----------------+  +-------------------------+
    |  OpenClaw        |  |  OCI Container Instance  |
    |  (Render Web     |  |  CI.Standard.A1.Flex     |
    |   Service)       |  |  1 OCPU + 6 GB RAM       |
    +-----------------+  |  ghcr.io/openclaw:latest  |
                          +-------------------------+
```

### 2.2 Abstraciao: CloudProviderDriver

Em vez de espalhar `if (provider === "oci")` por `cloud.ts`, a logica provider-especifica
e encapsulada em uma interface `CloudProviderDriver`. As rotas delegam para o driver correto
via um `Record<CloudProvider, CloudProviderDriver>`:

```typescript
// server/lib/cloud/driver.ts
export interface CloudProviderDriver {
  createOpenClaw(connection: CloudConnection, config: OpenClawConfig): Promise<DeployResult>;
  refresh(connection: CloudConnection, deployment: CloudDeployment): Promise<RefreshResult>;
  updateOpenClaw(connection: CloudConnection, deployment: CloudDeployment, config: OpenClawConfig): Promise<DeployResult>;
  deleteDeployment(connection: CloudConnection, deployment: CloudDeployment): Promise<void>;
  deleteConnection(connection: CloudConnection): Promise<void>;
}

// server/lib/cloud/index.ts
export const cloudDrivers: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  oci: ociDriver,
};
```

Isso elimina branching nas rotas e facilita adicionar futuros providers (Fly.io, Railway, etc.).

### 2.2 Servico OCI Escolhido: Container Instances

**Container Instances** e a opcao ideal porque:

- Serverless — sem gerenciar VMs, OS, ou Docker daemon
- Puxa imagens diretamente do ghcr.io (sem OCIR necessario)
- Shape `CI.Standard.A1.Flex` (ARM) — elegivel ao budget free do A1
- Suporta env vars, health checks (TCP/HTTP), restart policies
- API REST completa para CRUD programatico via SDK

**Shape recomendado para deploy OpenClaw:**

| Parametro | Valor |
|-----------|-------|
| Shape | `CI.Standard.A1.Flex` |
| OCPUs | 1 |
| Memoria | 6 GB |
| Storage efemero | 15 GB (incluso, sem custo) |
| Restart policy | `ALWAYS` |
| Image | `ghcr.io/openclaw/openclaw:latest` |

> **Budget mensal:** 1 OCPU x 744h = 744 OCPU-hours + 6 GB x 744h = 4,464 GB-hours.
> Limite free: 3,000 OCPU-hours + 18,000 GB-hours/mes.
>
> **IMPORTANTE:** Este budget e **compartilhado** entre VMs, bare metal e Container Instances.
> Se o usuario tiver outras instancias A1 rodando na mesma conta OCI, o budget free sera
> dividido entre todas. O ModelHub deve exibir um aviso sobre isso no formulario de conexao.

> **Nota de documentacao:** A pagina oficial [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) lista apenas VMs na secao A1. Porem, a [FAQ de Container Instances](https://www.oracle.com/europe/cloud/cloud-native/container-instances/faq/) e a [pagina de pricing](https://www.oracle.com/cloud/cloud-native/container-instances/pricing/) confirmam explicitamente que o budget e compartilhado com Container Instances. Este detalhe deve ser comunicado ao usuario.

### 2.3 Infraestrutura de Rede (100% gerenciada pelo ModelHub)

Diferente do Render (que abstrai toda a rede), o OCI requer setup explicito de networking. O ModelHub cria toda essa infraestrutura **automaticamente** na primeira conexao — o usuario nao precisa tocar no console OCI para rede:

```
VCN "modelhub-vcn" (10.0.0.0/16)
+-- Internet Gateway "modelhub-igw"
+-- Route Table (0.0.0.0/0 -> IGW)
+-- Public Subnet "modelhub-subnet" (10.0.0.0/24)
    +-- Security List (ingress TCP 10000, egress all)
    +-- Container Instance (IP publico)
```

**Identificacao por tags (nao displayName):** Todos os recursos criados pelo ModelHub recebem `freeformTags`:

```json
{
  "managedBy": "modelhub",
  "connectionId": "<cloud-connection-id>",
  "userId": "<user-id>"
}
```

`ensureOciNetworking()` busca recursos existentes por tag `managedBy=modelhub` + `connectionId` antes de criar (idempotente). Isso evita colisao com recursos criados manualmente pelo usuario ou por outra instancia ModelHub. `deleteOciNetworking()` so remove recursos com a tag correspondente.

Os OCIDs sao armazenados no campo `config` (JSON) do `CloudConnection` como cache para evitar lookups repetidos.

**Requisito de IAM:** O usuario OCI precisa ter permissoes para Compute, Virtual Network e Container Instances. Se faltar permissao, a API OCI retorna `404 NotAuthorizedOrNotFound`. O ModelHub interpreta esse erro e exibe mensagem especifica: "Seu usuario OCI nao tem permissao para [recurso]. Peca ao admin da conta para adicionar as policies necessarias." A validacao de IAM e oportunistica (tenta e interpreta o erro), nao preventiva.

---

## 3. Autenticacao OCI

### 3.1 Estrategia Plug-and-Play: Key Pair Gerenciado pelo ModelHub

O ModelHub **gera o par de chaves RSA** internamente e computa o fingerprint automaticamente.
O usuario so precisa fornecer 2 campos + copiar a public key para o OCI Console:

| O que | Quem faz | Como |
|-------|----------|------|
| RSA key pair (2048-bit) | **ModelHub gera** | `crypto.generateKeyPairSync('rsa', ...)` no backend |
| Fingerprint | **ModelHub computa** | MD5 do DER-encoded public key, formatado `xx:xx:...:xx` |
| Private key PEM | **ModelHub armazena** | Encriptada com AES-256 via `encryptCredential()` |
| Regiao | **ModelHub sugere** | Default `sa-saopaulo-1`, dropdown editavel |
| Compartment OCID | **ModelHub deduz** | Root compartment = tenancy OCID (padrao) |
| Tenancy OCID | **Usuario cola** | 1 campo — encontrado em OCI Console > Tenancy Details |
| User OCID | **Usuario cola** | 1 campo — encontrado em OCI Console > User Settings |
| Upload da public key | **Usuario copia** | ModelHub exibe a public key + deep link pro Console |

**Resultado: 2 campos + 1 acao externa (copiar public key no Console).**

Nenhuma chave privada sai do OCI Console do usuario, nenhum config file, nenhum fingerprint manual.

### 3.2 Como Funciona a Autenticacao

O OCI usa **HTTP Signature** (draft-cavage-http-signatures):

1. Monta uma **signing string** com headers HTTP especificos
2. Assina com a chave privada RSA usando **RSA-SHA256**
3. Codifica em Base64
4. Inclui no header `Authorization`

```
Authorization: Signature version="1",
  keyId="<tenancy_ocid>/<user_ocid>/<fingerprint>",
  algorithm="rsa-sha256",
  headers="(request-target) date host x-content-sha256 content-type content-length",
  signature="<base64_signature>"
```

O SDK `oci-common` abstrai completamente esse processo — basta instanciar o `SimpleAuthenticationDetailsProvider`.

### 3.3 Geracao de Key Pair no Backend

```typescript
import { generateKeyPairSync, createHash } from 'node:crypto';

export function generateOciApiKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Fingerprint = MD5 do DER-encoded public key, formatado xx:xx:...:xx
  const derBuffer = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  }).publicKey.export({ type: 'spki', format: 'der' });
  // Na pratica, reutilizar o publicKey gerado acima:
  const derFromPem = Buffer.from(
    publicKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''),
    'base64',
  );
  const md5 = createHash('md5').update(derFromPem).digest('hex');
  const fingerprint = md5.match(/.{2}/g)!.join(':');

  return { publicKeyPem: publicKey, privateKeyPem: privateKey, fingerprint };
}
```

### 3.4 SDK TypeScript

```bash
pnpm add oci-common oci-containerinstances oci-core
```

- `oci-common` — autenticacao, signing, HTTP client (~v2.131+)
- `oci-containerinstances` — client para Container Instances (~v2.112+)
- `oci-core` — VCN, subnets, security lists (networking)

> **Nota:** `oci-sdk` instala tudo (~100+ packages). Preferir packages individuais para manter o bundle enxuto.

**Autenticacao programatica com credenciais geradas:**

```typescript
import { SimpleAuthenticationDetailsProvider, Region } from 'oci-common';

const provider = new SimpleAuthenticationDetailsProvider(
  tenancyId,     // string — fornecido pelo usuario
  userId,        // string — fornecido pelo usuario
  fingerprint,   // string — computado pelo ModelHub
  privateKeyPem, // string — gerado pelo ModelHub, descriptografado do banco
  null,          // passphrase (sem passphrase, gerado por nos)
  Region.fromRegionId(region), // Region — default sa-saopaulo-1
);
```

### 3.5 Armazenamento Seguro

| Dado | Tratamento | Justificativa |
|------|-----------|---------------|
| Private key PEM | `encryptCredential()` (AES-256) | Secret critico — gerado pelo ModelHub |
| Fingerprint | `encryptCredential()` (AES-256) | Derivado da public key |
| Public key PEM | Plaintext no `config` JSON | Necessaria para resume do wizard se o usuario fechar o browser |
| Tenancy OCID | Plaintext no `config` JSON | Identificador publico |
| User OCID | Plaintext no `config` JSON | Identificador publico |
| Compartment OCID | Plaintext no `config` JSON | Identificador publico |
| Regiao | Plaintext no `config` JSON | Informacao publica |
| OCIDs de infra (VCN, subnet, etc.) | Plaintext no `config` JSON | Identificadores internos |

A private key PEM e armazenada no campo `token` do `CloudConnection` (encriptada com AES-256), reaproveitando o mesmo fluxo do token Render. O fingerprint e armazenado encriptado no `config` JSON.

---

## 4. Implementacao — Camadas

### 4.1 Camada de Dados (Prisma)

O schema atual ja e multi-provider. O campo `provider` e `String` e o campo `config` e `Json?`:

**`lib/contracts.ts` — unica alteracao de tipo:**
```typescript
// Antes
type CloudProvider = "render";

// Depois
type CloudProvider = "render" | "oci";
```

**`prisma/schema.prisma`:** Nenhuma alteracao estrutural necessaria.

**Estrutura do `config` JSON para OCI (`CloudConnection`):**
```json
{
  "status": "connected",
  "tenancyOcid": "ocid1.tenancy.oc1...",
  "userOcid": "ocid1.user.oc1...",
  "compartmentOcid": "ocid1.compartment.oc1...",
  "region": "sa-saopaulo-1",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
  "networking": {
    "vcnOcid": "ocid1.vcn.oc1...",
    "subnetOcid": "ocid1.subnet.oc1...",
    "internetGatewayOcid": "ocid1.internetgateway.oc1...",
    "securityListOcid": "ocid1.securitylist.oc1...",
    "routeTableOcid": "ocid1.routetable.oc1..."
  }
}
```

O campo `status` tem 3 valores: `"pending_validation"` (aguardando usuario colar public key),
`"connected"` (validado), `"invalid"` (API key revogada). O campo `publicKeyPem` permite
re-exibir a chave se o usuario retomar o wizard.

O campo `networking` e populado no primeiro deploy (nao na conexao) — comeca como `null`.
```

**Estrutura do `config` JSON para OCI (`CloudDeployment`):**
```json
{
  "containerInstanceOcid": "ocid1.containerinstance.oc1...",
  "containerOcid": "ocid1.container.oc1...",
  "availabilityDomain": "Uocm:SA-SAOPAULO-1-AD-1",
  "model": "gpt-4o",
  "provider": "openai",
  "modelhubApiUrl": "https://modelhub.example.com/v1",
  "allowedOrigins": ["https://modelhub.example.com"],
  "controlUiUrl": "http://<ip>:10000",
  "healthUrl": "http://<ip>:10000/healthz",
  "readyUrl": "http://<ip>:10000/readyz",
  "webSocketUrl": "ws://<ip>:10000/ws",
  "gatewayToken": "<encrypted>"
}
```

### 4.2 Bugfix necessario: serializers hardcodam Render

Em `server/routes/cloud.ts`, as funcoes `serializeConnection` (linha ~117) e `serializeDeployment` (linha ~165) hardcodam `provider: RENDER_PROVIDER`. Isso precisa ser corrigido para usar `connection.provider` / `deployment.provider`:

```typescript
// serializeConnection — ANTES
provider: RENDER_PROVIDER,
// DEPOIS
provider: connection.provider as CloudProvider,

// serializeDeployment — ANTES
provider: RENDER_PROVIDER,
// DEPOIS
provider: deployment.provider as CloudProvider,
```

### 4.3 Camada Cloud Client (`server/lib/cloud/oci.ts`)

Novo arquivo seguindo o padrao de `render.ts`:

```
server/lib/cloud/
+-- render.ts   (existente, ~700 linhas)
+-- oci.ts      (NOVO, estimativa ~800-1000 linhas)
```

**Funcoes a implementar:**

| Funcao | Descricao |
|--------|-----------|
| `generateOciApiKeyPair()` | Gera RSA 2048 key pair + computa fingerprint MD5 |
| `validateOciCredentials()` | Valida credenciais chamando `listAvailabilityDomains` |
| `ensureOciNetworking()` | Cria VCN + IGW + Route + Subnet + Security List (idempotente) |
| `createOciOpenClawDeployment()` | Cria Container Instance com imagem OpenClaw |
| `refreshOciDeployment()` | Consulta status da Container Instance |
| `updateOciOpenClawDeployment()` | Recreate atomico (criar nova -> aguardar -> deletar antiga) |
| `deleteOciDeployment()` | Deleta Container Instance |
| `deleteOciNetworking()` | Remove infra de rede (cleanup na desconexao) |
| `getOciContainerLogs()` | Recupera logs do container |
| `isOciFreeTierError()` | Detecta erros de quota/limite/capacity |
| `buildOciOpenClawInfo()` | Monta URLs de health/ready/ws/controlUi a partir do IP |

**Constantes:**

```typescript
export const OCI_PROVIDER = "oci" as const;
export const OCI_OPENCLAW_SHAPE = "CI.Standard.A1.Flex";
export const OCI_OPENCLAW_OCPUS = 1;
export const OCI_OPENCLAW_MEMORY_GB = 6;
export const OCI_OPENCLAW_PORT = 10000;
export const OCI_OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:latest";
export const OCI_VCN_CIDR = "10.0.0.0/16";
export const OCI_SUBNET_CIDR = "10.0.0.0/24";
export const OCI_DISPLAY_PREFIX = "modelhub";
```

### 4.4 Camada de Rotas (`server/routes/cloud.ts`)

Novos endpoints (espelhando os do Render):

| Metodo | Path | Descricao |
|--------|------|-----------|
| `POST` | `/user/cloud/connections/oci` | Recebe OCIDs + regiao, gera key pair, retorna public key |
| `POST` | `/user/cloud/connections/oci/validate` | Valida conexao apos usuario adicionar key no Console |
| `POST` | `/user/cloud/deployments/oci/openclaw` | Deploy OpenClaw no OCI |

Endpoints existentes que viram **provider-agnostic** via `CloudProviderDriver`:

| Endpoint | Alteracao |
|----------|-----------|
| `POST /:id/refresh` | `cloudDrivers[provider].refresh(...)` |
| `DELETE /:id` | `cloudDrivers[provider].deleteDeployment(...)` |
| `PATCH /:id/openclaw` | `cloudDrivers[provider].updateOpenClaw(...)` |
| `DELETE /connections/:id` | `cloudDrivers[provider].deleteConnection(...)` |
| `GET /:id/gateway-token` | Ja funciona (token no config JSON, provider-agnostic) |
| `POST /:id/api/chat` | Ja funciona (usa publicUrl generico, **mas precisa fix de `maxDuration`**) |

### 4.5 Camada de UI (`components/dashboard/cloud-section.tsx`)

#### 4.5.1 Seletor de Provider (novo)

Ao clicar "Conectar Cloud", o usuario ve um seletor visual:

```
+---------------------------+  +---------------------------+
|  [Render logo]            |  |  [Oracle logo]            |
|  Render                   |  |  Oracle Cloud (OCI)       |
|  Simples, 1 API key       |  |  Poderoso, sem cold start |
|  0.1 CPU / 512 MB         |  |  1 OCPU / 6 GB RAM       |
|  Sleep apos 15 min        |  |  Always-on, gratuito      |
|  Setup: ~30s              |  |  Setup: ~2 min            |
|  [Conectar]               |  |  [Conectar]               |
+---------------------------+  +---------------------------+
```

#### 4.5.2 Formulario de Conexao OCI (2 campos + 1 acao)

**Step 1 — Identificacao da conta:**
```
+-----------------------------------------------------------+
|  Conectar Oracle Cloud (OCI)                               |
|                                                            |
|  Tenancy OCID                                              |
|  [ocid1.tenancy.oc1..________________________]             |
|  Onde encontrar: OCI Console > Tenancy Details    [?]      |
|                                                            |
|  User OCID                                                 |
|  [ocid1.user.oc1..__________________________]              |
|  Onde encontrar: OCI Console > User Settings      [?]      |
|                                                            |
|  Regiao              [sa-saopaulo-1       v]               |
|                       (recomendado para BR)                |
|                                                            |
|                                  [ Gerar Chave de Acesso ] |
+-----------------------------------------------------------+
```

Validacao inline: regex `ocid1\.(tenancy|user)\.oc1\.\..{60}` — feedback
instantaneo se o formato esta correto.

**Step 2 — Autorizar ModelHub (copiar public key):**
```
+-----------------------------------------------------------+
|  Autorizar ModelHub                                        |
|                                                            |
|  Copie a chave publica abaixo e adicione ao seu            |
|  usuario no OCI Console:                                   |
|                                                            |
|  +-----------------------------------------------+        |
|  | -----BEGIN PUBLIC KEY-----                     |        |
|  | MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...           |        |
|  | -----END PUBLIC KEY-----                       |        |
|  +-----------------------------------------------+        |
|                           [Copiar Chave]  [Copiado!]       |
|                                                            |
|  Como fazer:                                               |
|  1. Clique no botao abaixo para abrir o OCI Console        |
|  2. Va em "API Keys" > "Add API Key"                       |
|  3. Selecione "Paste a public key"                         |
|  4. Cole a chave copiada acima e clique "Add"              |
|  5. Volte aqui                                             |
|                                                            |
|  [Abrir OCI Console ->]      [ Ja colei, validar ]         |
+-----------------------------------------------------------+
```

O deep link abre diretamente a pagina de API Keys do usuario:
`https://cloud.oracle.com/identity/users/<user-ocid>/api-keys`

**Resiliencia do wizard:**
- A public key e persistida no `config` JSON da `CloudConnection` (status `pending_validation`).
  Se o usuario fechar o browser, ao reabrir ele ve o Step 2 com a mesma public key — sem precisar regerar.
- O botao "Ja colei, validar" faz **ate 3 tentativas** com delay de 2s entre elas (a API Key pode
  demorar alguns segundos para propagar no OCI). Se falhar, exibe: "Chave ainda nao detectada.
  Verifique se colou no usuario correto e tente novamente."

**Step 3 — Validacao:**
```
+-----------------------------------------------------------+
|  Validando conexao...                                      |
|                                                            |
|  [x] Autenticacao bem-sucedida                             |
|  [x] Availability Domain detectado                         |
|  [x] Rede sera configurada automaticamente                 |
|                                                            |
|  [i] O budget free A1 (3000 OCPU-h / 18000 GB-h) e        |
|      compartilhado com outras instancias A1 na sua conta.  |
|                                                            |
|  [i] Seu usuario OCI precisa ter permissoes para           |
|      Compute, Virtual Network e Container Instances.       |
|                                                            |
|  Conectado!                            [ Ir para Deploy ]  |
+-----------------------------------------------------------+
```

#### 4.5.3 Onde encontrar os OCIDs (tooltips [?])

Ao clicar no icone [?] ao lado de cada campo, exibe um popover:

**Tenancy OCID:**
```
1. Acesse cloud.oracle.com
2. Clique no icone de perfil (canto superior direito)
3. Clique em "Tenancy: <nome>"
4. Copie o OCID exibido
```

**User OCID:**
```
1. Acesse cloud.oracle.com
2. Clique no icone de perfil (canto superior direito)
3. Clique em "User Settings" (ou "My Profile")
4. Copie o OCID exibido
```

#### 4.5.4 Card de Deployment OCI

Apos deploy, o card mostra:

```
+---------------------------------------------------+
| Oracle Cloud (OCI)              [Pronto]           |
| modelhub-openclaw-a1b2c3d4                         |
|                                                    |
| Regiao:       sa-saopaulo-1                        |
| Shape:        CI.Standard.A1.Flex (1 OCPU, 6 GB)  |
| Modelo:       gpt-4o  Provider: openai             |
|                                                    |
| O chat com este agente funciona diretamente        |
| pelo ModelHub (via proxy HTTPS).                   |
|                                                    |
| [Configurar]  [Refresh]  [Remover]                 |
|                                                    |
| v Acesso direto (avancado)                         |
| +-----------------------------------------------+ |
| | IP Publico:  http://129.151.x.x:10000 [Copiar]| |
| | Control UI:  http://129.151.x.x:10000  [Abrir]| |
| | WebSocket:   ws://129.151.x.x:10000/ws         | |
| | Health:      http://129.151.x.x:10000/healthz  | |
| |                                                 | |
| | [!] Conexao direta sem HTTPS.                   | |
| +-----------------------------------------------+ |
+---------------------------------------------------+
```

O acesso direto (IP publico, Control UI, WebSocket) fica em secao **colapsada por padrao**. O fluxo principal do usuario e via chat proxy HTTPS do ModelHub — sem exposicao a HTTP. Usuarios avancados podem expandir para acessar diretamente.

---

## 5. Fluxo de Uso (UX)

### 5.1 Conexao Inicial (< 2 minutos)

O wizard tem 3 estados persistentes: `identifying` -> `pending_validation` -> `connected`.
Se o usuario fechar o browser a qualquer momento, ao reabrir ele retoma de onde parou.

```
1. Usuario clica "Conectar Cloud" no Dashboard
2. Seleciona "Oracle Cloud (OCI)"
3. [IDENTIFICAR] Cola Tenancy OCID + User OCID (2 campos), seleciona regiao
4. Clica "Gerar Chave de Acesso"
5. Backend gera RSA key pair, salva conexao como `pending_validation`
   (public key no config JSON, private key encriptada no token)
6. [AUTORIZAR] Frontend exibe a PUBLIC key + deep link pro OCI Console
7. Usuario copia a public key e adiciona no Console OCI (paste + click)
8. Volta ao ModelHub e clica "Ja colei, validar"
9. Backend tenta validar (ate 3 retries com 2s delay — propagacao da key)
10. [CONECTADO] Conexao confirmada — pronto para deploy
```

Se o usuario reabrir o ModelHub com conexao `pending_validation`, ve diretamente o Step 2
com a mesma public key — sem precisar regerar.

### 5.2 Deploy do OpenClaw (< 1 minuto)

```
1. Usuario clica "Deploy OpenClaw" (ja conectado ao OCI)
2. Seleciona modelo e provider (igual ao Render)
3. POST /user/cloud/deployments/oci/openclaw
4. Backend (transparente para o usuario):
   a. ensureOciNetworking() — cria VCN/subnet se necessario (idempotente)
   b. Detecta Availability Domain automaticamente
   c. Gera gateway token
   d. Cria Container Instance com env vars do OpenClaw
   e. Retorna status "provisioning"
5. Frontend faz polling via POST /:id/refresh
6. Container Instance fica "ACTIVE" em ~30-60s
7. UI exibe IP publico + porta (http://<ip>:10000)
8. Chat proxy do ModelHub ja funciona via HTTPS
```

### 5.3 Atualizacao de Configuracao (transparente)

```
1. Usuario altera modelo/provider no painel OpenClaw
2. Clica "Salvar"
3. Backend executa recreate atomico:
   a. Cria NOVA Container Instance com config atualizada
   b. Aguarda status ACTIVE (~30-60s)
   c. Deleta instance ANTIGA
   d. Atualiza registro no banco
4. UI mostra "Atualizando..." durante o processo
5. Downtime efetivo: ~30-60s (vs ~2-5 min no Render)
```

### 5.4 Comparativo de UX — Render vs OCI

| Aspecto | Render | OCI |
|---------|--------|-----|
| Setup | 1 API key | 2 OCIDs + copiar 1 chave publica |
| URL do servico | `https://name.onrender.com` | `http://<ip>:10000` (sem TLS nativo) |
| Tempo de deploy | 2-5 min (build) | 30-60s (pull + start) |
| Cold start | 30-60s apos 15 min idle | Nenhum |
| TLS | Automatico | Via chat proxy HTTPS do ModelHub |
| Update de config | Redeploy (2-5 min) | Recreate (~30-60s) |
| Rede | Abstraida | 100% gerenciada pelo ModelHub |
| Custo | Gratuito | Gratuito (budget compartilhado) |

---

## 6. Desafios e Mitigacoes

### 6.0 Bug pre-existente: timeout do chat proxy (corrigir ANTES do OCI)

**Problema:** `app/user/[...path]/route.ts` define `maxDuration = 60` (60s), e `vercel.json` impoe 60s globalmente. Porem o chat proxy OpenClaw em `server/routes/cloud.ts` tenta ate 340s (`OPENCLAW_OVERALL_TIMEOUT_MS`). No Vercel, a funcao morre em 60s — o proxy nunca consegue esperar o tempo completo.

**Correcao:** Mover o endpoint de chat proxy (`POST /user/cloud/deployments/:id/api/chat`) para uma rota Next.js com `maxDuration` adequado (180s+), ou ajustar `vercel.json` para dar mais tempo a rotas `/user/cloud/*`. Esse bug afeta o Render hoje e deve ser corrigido independente do OCI.

### 6.1 Complexidade da API OCI

**Problema:** OCI requer RSA signing e setup explicito de networking (vs simple Bearer token do Render).

**Mitigacao:** SDK TypeScript oficial (`oci-common`) abstrai o signing. Setup de rede e one-time, idempotente, e 100% automatizado pelo ModelHub. O usuario nunca precisa tocar no console OCI para rede.

### 6.2 Sem HTTPS Nativo

**Problema:** Container Instances com IP publico nao tem TLS automatico.

**Mitigacao principal:** O **chat proxy** do ModelHub (`POST /:id/chat/completions`) ja roda em HTTPS e faz relay para o container. O usuario que usa o chat do ModelHub ja esta protegido. Exibir aviso claro na UI para quem acessar o Control UI diretamente.

**Mitigacao futura (Fase 2):** Configurar o Free Flexible Load Balancer do OCI com certificado TLS (Let's Encrypt), provendo HTTPS gratuito para acesso direto.

### 6.3 Container Instances sao Imutaveis

**Problema:** Nao e possivel alterar env vars de uma Container Instance existente.

**Mitigacao:** Recreate atomico na funcao `updateOciOpenClawDeployment()`:
1. Criar nova instance com env vars atualizados
2. Aguardar status `ACTIVE`
3. Deletar instance antiga
4. Atualizar registro no banco com novo OCID e IP

O UI exibe "Atualizando..." com progress indicator durante o processo.

### 6.4 "Out of Host Capacity" em Algumas Regioes

**Problema:** Regioes populares podem ter escassez de instancias A1.

**Mitigacao:**
- Dropdown de regiao com indicador de disponibilidade estimada
- Recomendar `sa-saopaulo-1` como padrao para usuarios BR
- Retry com backoff exponencial (3 tentativas)
- Mensagem clara: "Capacidade temporariamente esgotada em [regiao]. Tente [regiao alternativa] ou aguarde alguns minutos."

### 6.5 Reclamacao de Instancias Ociosas

**Problema:** Oracle pode parar instancias Always Free com CPU < 20% por 7 dias.

**Mitigacao:**
- Agente OpenClaw ativo normalmente nao e afetado (responde a requests)
- Exibir aviso na UI: "Para garantia total, converta para Pay-As-You-Go (sem custo adicional)"
- Se a instancia for parada, o `refreshOciDeployment` detecta estado `STOPPED` e oferece botao "Reiniciar"
- Link direto para conversao PAYG no console OCI

### 6.6 Seguranca do Key Pair Gerenciado

**Problema:** O ModelHub gera e armazena a private key — responsabilidade de seguranca.

**Mitigacoes:**
- Private key gerada no backend com `crypto.generateKeyPairSync` (RSA 2048-bit)
- Encriptada imediatamente com AES-256 via `encryptCredential()` antes de persistir
- Nunca logada, nunca retornada ao frontend, nunca exibida apos geracao
- Somente a **public key** e exibida ao usuario (para colar no OCI Console)
- O usuario pode revogar a API Key no OCI Console a qualquer momento (invalidando o acesso)
- Desconectar a conta OCI no ModelHub deleta a private key do banco

### 6.7 Budget Free Compartilhado

**Problema:** O budget A1 (3,000 OCPU-h + 18,000 GB-h) e compartilhado com TODAS as instancias A1 da conta.

**Mitigacao:**
- Aviso claro no formulario de conexao
- O deploy padrao (1 OCPU + 6 GB) consome ~25% do budget OCPU e ~25% do budget RAM
- Exibir estimativa: "Este deploy usara ~744/3000 OCPU-h e ~4464/18000 GB-h por mes"

### 6.8 Permissoes IAM do Usuario OCI

**Problema:** Se o usuario nao for admin da conta OCI, criar VCN, subnet, security list e Container Instance vai falhar com `404 NotAuthorizedOrNotFound`.

**Mitigacao:**
- Nao fazer preflight complexo de permissoes — tentar a operacao e interpretar o erro
- Quando detectar `404 NotAuthorizedOrNotFound`, exibir mensagem especifica: "Seu usuario OCI nao tem permissao para [recurso]. Peca ao admin para adicionar policies de Compute, Virtual Network e Container Instances."
- Documentar no wizard as policies OCI necessarias (link para doc Oracle)
- O MVP assume explicitamente: "use um usuario OCI com permissoes de admin ou com policies de manage para compute, vcn e container-instances no compartment"

### 6.9 Rate Limiting de Geracao de Key Pairs

**Problema:** Sem limite, um usuario pode gerar dezenas de key pairs sem usar, acumulando lixo.

**Mitigacao:**
- Limitar a 3 conexoes OCI pendentes (status `pending_validation`) por usuario
- Se ja existir uma conexao pendente, exibir a public key existente em vez de gerar nova
- Conexoes pendentes por mais de 24h sao limpas automaticamente (cron ou lazy cleanup no acesso)

### 6.10 Revogacao/Rotacao de API Key

**Problema:** Se o usuario deletar a API Key no Console OCI, o ModelHub perde acesso sem aviso.

**Mitigacao:**
- No `refreshOciDeployment()`, se a API retornar `401 NotAuthenticated`, marcar a conexao como `invalid`
- Exibir na UI: "Conexao OCI invalida — a API Key pode ter sido revogada. Reconecte sua conta."
- Botao "Reconectar" que regenera um novo key pair e reinicia o wizard a partir do Step 2

---

## 7. Fases de Implementacao

### Fase 0 — Spike de validacao (2-3 dias)

Objetivo: **eliminar incerteza** antes de investir em UI/rotas. Criar Container Instance real via SDK e validar o fluxo completo end-to-end.

- [ ] Script standalone que usa `oci-common` + `oci-containerinstances` + `oci-core`
- [ ] Criar VCN + subnet + security list em `sa-saopaulo-1` (testar disponibilidade A1)
- [ ] Criar Container Instance com `ghcr.io/openclaw/openclaw:latest`
- [ ] Validar: work request completion, IP publico atribuido, health `/healthz` respondendo
- [ ] Testar chat proxy: enviar request para `http://<ip>:10000/v1/chat/completions`
- [ ] Testar cleanup: deletar Container Instance + networking
- [ ] Se `sa-saopaulo-1` falhar com "Out of host capacity", testar `sa-vinhedo-1` como fallback
- [ ] Documentar tempos reais (provisioning, health ready, chat response)

> **Gate:** So prosseguir para Fase 1 se o spike confirmar que Container Instances A1 funcionam
> de forma confiavel na regiao alvo.

### Fase 0.5 — Correcoes pre-existentes (1-2 dias)

- [ ] Corrigir bug de timeout: `maxDuration` do chat proxy vs `vercel.json` (secao 6.0)
- [ ] Corrigir serializers hardcoded: `serializeConnection` e `serializeDeployment` (secao 4.2)
- [ ] Criar interface `CloudProviderDriver` em `server/lib/cloud/driver.ts` (secao 2.2)
- [ ] Refatorar `render.ts` para implementar a interface (sem mudanca de comportamento)

### Fase 1 — MVP OCI (estimativa: 2-3 semanas)

**Dados e tipos:**
- [ ] Adicionar `"oci"` ao tipo `CloudProvider` em `lib/contracts.ts`

**Backend (`server/lib/cloud/oci.ts` — implementa `CloudProviderDriver`):**
- [ ] `generateOciApiKeyPair()` — gera RSA 2048 key pair + computa fingerprint MD5
- [ ] `validateOciCredentials()` — valida chamando `listAvailabilityDomains`
- [ ] `ensureOciNetworking()` — VCN + IGW + Route + Subnet + Security List (idempotente, com tags)
- [ ] `createOciOpenClawDeployment()` — cria Container Instance (com `freeformTags`)
- [ ] `refreshOciDeployment()` — consulta status + detecta `401` (key revogada)
- [ ] `deleteOciDeployment()` — deleta Container Instance
- [ ] `deleteOciNetworking()` — remove infra de rede (somente recursos com tag `managedBy=modelhub`)
- [ ] `buildOciOpenClawInfo()` — monta URLs a partir do IP publico
- [ ] `isOciFreeTierError()` — detecta erros de quota/capacity/IAM

**Rotas (`server/routes/cloud.ts` — via `CloudProviderDriver`):**
- [ ] `POST /user/cloud/connections/oci` (recebe OCIDs + regiao, gera key pair, retorna public key)
- [ ] `POST /user/cloud/connections/oci/validate` (retry com 3 tentativas e delay 2s)
- [ ] `POST /user/cloud/deployments/oci/openclaw`
- [ ] Rotas existentes (`refresh`, `delete`) delegam para driver por `provider`

**Frontend (`components/dashboard/cloud-section.tsx`):**
- [ ] Seletor de provider (Render / OCI) com cards visuais
- [ ] Wizard de 3 steps: Identificar conta -> Autorizar ModelHub -> Deploy
- [ ] Step 2 com persistencia (public key no config JSON, resume se fechar browser)
- [ ] Botao "Ja colei, validar" com retry automatico
- [ ] Card de deployment OCI com secao "Acesso direto" colapsada
- [ ] Avisos: budget compartilhado, IAM, HTTPS

**Infra:**
- [ ] `pnpm add oci-common@2.132.0 oci-containerinstances@2.132.0 oci-core@2.132.0` (pinar mesma versao)
- [ ] Testes unitarios para `oci.ts` (mocking do SDK)
- [ ] Rate limit: max 3 conexoes OCI pendentes por usuario

### Fase 1.5 — Update/recreate atomico (1 semana)

Nao deixar `PATCH /openclaw` "meio suportado" — ou funciona completo ou nao existe.

- [ ] `updateOciOpenClawDeployment()` — criar nova instance -> aguardar ACTIVE -> deletar antiga
- [ ] Progress indicator na UI durante recreate
- [ ] Rollback: se nova instance falhar, manter a antiga e reportar erro
- [ ] Testes para cenarios de falha (nova instance falha, antiga ja deletada, etc.)

### Fase 2 — HTTPS, Logs e Polish (1-2 semanas)

- [ ] Configurar OCI Flexible Load Balancer (free) com TLS via Let's Encrypt
- [ ] Logs do container via `RetrieveLogs` API (exibir no dashboard)
- [ ] Tratamento de "Out of host capacity" com sugestao de regiao alternativa
- [ ] Botao "Reiniciar" para instancias STOPPED (idle reclaim)
- [ ] Deteccao de API Key revogada + botao "Reconectar"
- [ ] Cleanup automatico de conexoes pendentes > 24h

### Fase 3 — VM Alternativa (futuro)

- [ ] Opcao de deploy em Compute Instance (`VM.Standard.A1.Flex`) para mais controle
- [ ] Cloud-init script para setup automatico de Docker + OpenClaw
- [ ] Ate 4 OCPUs + 24 GB RAM (recursos completos do free tier)
- [ ] Persistencia de dados com block storage

---

## 8. Dependencias e Pacotes

### NPM Packages

Pinar os tres na mesma versao para evitar incompatibilidades internas do SDK:

```json
{
  "oci-common": "2.132.0",
  "oci-containerinstances": "2.132.0",
  "oci-core": "2.132.0"
}
```

### API Endpoints OCI Utilizados

**Container Instances** (`compute-containers.{region}.oci.oraclecloud.com/20210415`):

| Operacao | Metodo | Path |
|----------|--------|------|
| Criar instancia | `POST` | `/containerInstances` |
| Obter instancia | `GET` | `/containerInstances/{id}` |
| Listar instancias | `GET` | `/containerInstances` |
| Deletar instancia | `DELETE` | `/containerInstances/{id}` |
| Iniciar instancia | `POST` | `/containerInstances/{id}/actions/start` |
| Parar instancia | `POST` | `/containerInstances/{id}/actions/stop` |
| Obter logs | `GET` | `/containers/{id}/logs` |

**Networking** (`iaas.{region}.oraclecloud.com/20160918`):

| Operacao | Metodo | Path |
|----------|--------|------|
| Criar VCN | `POST` | `/vcns` |
| Criar Internet Gateway | `POST` | `/internetGateways` |
| Criar Subnet | `POST` | `/subnets` |
| Atualizar Route Table | `PUT` | `/routeTables/{id}` |
| Criar/Atualizar Security List | `POST`/`PUT` | `/securityLists` |
| Listar Availability Domains | `GET` | `/availabilityDomains` |
| Listar VCNs | `GET` | `/vcns` |
| Listar Subnets | `GET` | `/subnets` |

**Identity** (`identity.{region}.oraclecloud.com/20160918`):

| Operacao | Metodo | Path |
|----------|--------|------|
| Listar Compartments | `GET` | `/compartments` |

---

## 9. Exemplo de Codigo — Criacao de Container Instance

```typescript
import * as common from 'oci-common';
import * as ci from 'oci-containerinstances';

export async function createOciOpenClawDeployment(
  credentials: OciCredentials,
  subnetOcid: string,
  availabilityDomain: string,
  envVars: Record<string, string>,
  serviceName: string,
) {
  const authProvider = new common.SimpleAuthenticationDetailsProvider(
    credentials.tenancyOcid,
    credentials.userOcid,
    credentials.fingerprint,
    credentials.privateKeyPem,
    null,
    common.Region.fromRegionId(credentials.region),
  );

  const client = new ci.ContainerInstanceClient({
    authenticationDetailsProvider: authProvider,
  });

  const response = await client.createContainerInstance({
    createContainerInstanceDetails: {
      compartmentId: credentials.compartmentOcid,
      availabilityDomain,
      displayName: serviceName,
      shape: OCI_OPENCLAW_SHAPE,
      shapeConfig: {
        ocpus: OCI_OPENCLAW_OCPUS,
        memoryInGBs: OCI_OPENCLAW_MEMORY_GB,
      },
      containers: [
        {
          imageUrl: OCI_OPENCLAW_IMAGE,
          displayName: 'openclaw',
          environmentVariables: envVars,
          healthChecks: [
            {
              healthCheckType:
                ci.models.ContainerHealthCheck.HealthCheckType.Tcp,
              port: OCI_OPENCLAW_PORT,
              initialDelayInSeconds: 15,
              intervalInSeconds: 30,
              failureThreshold: 3,
              successThreshold: 1,
              timeoutInSeconds: 5,
              failureAction:
                ci.models.ContainerHealthCheck.FailureAction.Kill,
            },
          ],
        },
      ],
      vnics: [
        {
          subnetId: subnetOcid,
          isPublicIpAssigned: true,
        },
      ],
      containerRestartPolicy:
        ci.models.ContainerInstance.ContainerRestartPolicy.Always,
      gracefulShutdownTimeoutInSeconds: 30,
    },
  });

  return {
    containerInstanceId: response.containerInstance.id,
    workRequestId: response.opcWorkRequestId,
    status: 'provisioning' as const,
  };
}
```

---

## 10. Comparativo Final — Render vs OCI

| Caracteristica | Render Free | OCI Always Free |
|---------------|------------|-----------------|
| **CPU** | 0.1 CPU | 1 OCPU ARM (~40x) |
| **RAM** | 512 MB | 6 GB (~12x) |
| **Sleep** | 15 min inatividade | Sem sleep |
| **Cold start** | 30-60s | Nenhum |
| **Banda mensal** | 100 GB | 10 TB |
| **HTTPS** | Automatico | Via chat proxy (ModelHub HTTPS) |
| **Setup** | 1 API key | 2 OCIDs + copiar public key |
| **Deploy time** | 2-5 min | 30-60s |
| **Complexidade API** | Baixa | Alta (abstraida pelo ModelHub) |
| **Persistencia** | Efemera | Efemera (CI) / Persistente (VM, Fase 3) |
| **Expiracao** | Sujeito a mudancas | Sem expiracao (idle reclaim se <20% CPU) |
| **Budget** | Exclusivo por servico | Compartilhado entre instancias A1 |
| **Custo real** | Gratuito | Gratuito |

### Recomendacao ao Usuario (exibida no seletor)

- **Render** (modo simples): Para quem quer setup instantaneo e aceita cold starts. 1 API key, pronto em 30 segundos.
- **OCI** (modo poderoso): Para quem quer performance e disponibilidade sem custo. 2 IDs + copiar 1 chave, pronto em 2 minutos. Requer conta Oracle Cloud (gratuita).

---

## 11. Regioes OCI Recomendadas

| Regiao | Identifier | Disponibilidade A1 | Latencia para BR |
|--------|-----------|--------------------|--------------------|
| Sao Paulo | `sa-saopaulo-1` | Boa | Muito baixa |
| Vinhedo (SP) | `sa-vinhedo-1` | Boa | Muito baixa |
| Santiago | `sa-santiago-1` | Boa | Baixa |
| Phoenix | `us-phoenix-1` | Boa | Media |
| Ashburn | `us-ashburn-1` | Variavel (alta demanda) | Media |
| Frankfurt | `eu-frankfurt-1` | Boa | Alta |

> **Padrao para usuarios BR:** `sa-saopaulo-1` (pre-selecionado no dropdown)

---

## 12. Riscos e Contingencias

| Risco | Prob. | Impacto | Contingencia |
|-------|-------|---------|-------------|
| "Out of host capacity" na regiao | Media | Alto | Retry + sugestao de regiao alternativa; spike valida antes |
| Oracle altera Always Free | Baixa | Alto | Render como fallback; monitorar anuncios Oracle |
| Chave PEM comprometida no banco | Muito baixa | Critico | AES-256 encryption; rotacao de ENCRYPTION_KEY |
| Container Instance em estado inconsistente | Baixa | Medio | Cleanup por tags + botao "Forcar Redeploy" |
| SDK OCI com breaking changes | Media | Baixo | Pin exato de versao (2.132.0); testes no CI |
| Budget free excedido (instancias A1 extras) | Media | Medio | Aviso proativo na UI com estimativa de consumo |
| Instancia reclamada por idle | Baixa | Medio | Detectar STOPPED; botao "Reiniciar"; sugerir PAYG |
| Usuario sem permissao IAM | Media | Alto | Interpretar `404 NotAuthorizedOrNotFound`; mensagem especifica |
| API Key revogada no Console OCI | Baixa | Alto | Detectar `401` no refresh; botao "Reconectar" |
| Timeout do chat proxy (bug pre-existente) | Alta | Alto | Corrigir `maxDuration` antes de lancar OCI (Fase 0.5) |
| Colisao de recursos por displayName | Baixa | Medio | Usar `freeformTags` para identificacao, nao displayName |

---

## Referencias

- [OCI Container Instances — Documentacao](https://docs.oracle.com/en-us/iaas/Content/container-instances/overview-of-container-instances.htm)
- [OCI Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Container Instances FAQ (pricing/free tier)](https://www.oracle.com/europe/cloud/cloud-native/container-instances/faq/)
- [Container Instance Shapes](https://docs.oracle.com/en-us/iaas/Content/container-instances/container-instance-shapes.htm)
- [OCI API Signing (HTTP Signatures)](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/signingrequests.htm)
- [OCI SDK for TypeScript (GitHub)](https://github.com/oracle/oci-typescript-sdk)
- [SimpleAuthenticationDetailsProvider API](https://docs.oracle.com/en-us/iaas/tools/typescript/latest/classes/_common_lib_auth_auth_.simpleauthenticationdetailsprovider.html)
- [Container Instances REST API](https://docs.oracle.com/en-us/iaas/api/#/en/container-instances/20210415/)
- [OCI Networking (VCN/Subnets)](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/Overview_of_VCNs_and_Subnets.htm)
- [oci-containerinstances (npm)](https://www.npmjs.com/package/oci-containerinstances)
- [Idle Instance Reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm#idle)
- [Retrieve Container Logs](https://docs.oracle.com/en-us/iaas/Content/container-instances/retrieve-logs.htm)
- [Creating a Container Instance](https://docs.oracle.com/en-us/iaas/Content/container-instances/creating-a-container-instance.htm)
- [OCI Price List (Containers)](https://www.oracle.com/cloud/price-list/#pricing-containers)
