import type { Context } from "hono";
import { Hono } from "hono";

import {
  cloudDeploymentStatusSchema,
  openClawDeploymentConfigSchema,
  cloudRenderConnectionSchema,
  type CloudConnectionSummary,
  type CloudDeploymentStatus,
  type CloudDeploymentSummary,
  type OpenClawDeploymentSummary,
} from "@/lib/contracts";

import { decryptCredential, encryptCredential, generateApiKey } from "../lib/crypto";
import { prisma } from "../lib/db";
import {
  createRenderOpenClawDeployment,
  createRenderSpikeDeployment,
  deleteRenderService,
  buildOpenClawInfo,
  isRenderFreeTierError,
  RENDER_OPENCLAW_PLAN,
  RENDER_OPENCLAW_PORT,
  RENDER_OPENCLAW_REGION,
  RENDER_OPENCLAW_IMAGE,
  RENDER_PROVIDER,
  RENDER_SPIKE_PLAN,
  RENDER_SPIKE_PORT,
  RENDER_SPIKE_REGION,
  RENDER_SPIKE_REPO,
  refreshRenderDeployment,
  updateRenderOpenClawDeployment,
  validateRenderToken,
} from "../lib/cloud/render";
import { jsonErrorResponse } from "../lib/provider-core";
import { authenticateAccess, protectedCors, securityHeaders } from "../lib/security";

const app = new Hono().basePath("/user/cloud");

app.onError((error) => {
  console.error("[cloud] unhandled error", error);
  return jsonErrorResponse(500, "Falha ao carregar recursos de nuvem. Verifique se as migrations foram aplicadas.");
});

app.use("*", securityHeaders);
app.use("*", protectedCors);

app.use("*", async (c, next) => {
  const authError = await authenticateAccess(c);
  if (authError) return authError;
  return next();
});

function getUserId(c: Context): string | undefined {
  return c.get("userId") as string | undefined;
}

function requireAuth(c: Context): string | Response {
  const userId = getUserId(c);
  if (!userId) return jsonErrorResponse(401, "Authentication required");
  return userId;
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeStatus(status: string): CloudDeploymentStatus {
  const parsed = cloudDeploymentStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : "failed";
}

function objectConfig(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringFromConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArrayFromConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function serializeConnection(connection: {
  createdAt: Date | string;
  externalOrganizationName: string | null;
  externalUserEmail: string | null;
  id: string;
  label: string;
  provider: string;
  updatedAt: Date | string;
}): CloudConnectionSummary {
  return {
    createdAt: serializeDate(connection.createdAt),
    externalOrganizationName: connection.externalOrganizationName,
    externalUserEmail: connection.externalUserEmail,
    id: connection.id,
    label: connection.label,
    provider: RENDER_PROVIDER,
    updatedAt: serializeDate(connection.updatedAt),
  };
}

function serializeDeployment(deployment: {
  config?: unknown;
  connectionId: string;
  createdAt: Date | string;
  error: string | null;
  externalAppName: string;
  externalServiceId: string;
  id: string;
  image: string;
  instanceType: string;
  name: string;
  port: number;
  provider: string;
  publicUrl: string | null;
  region: string;
  status: string;
  updatedAt: Date | string;
}): CloudDeploymentSummary {
  const config = objectConfig(deployment.config);
  const configuredModel = config ? stringFromConfig(config, "model") : null;
  const configuredProvider = config ? stringFromConfig(config, "provider") : null;
  const configuredApiUrl = config ? stringFromConfig(config, "modelhubApiUrl") : null;
  const serviceUrl = deployment.publicUrl ?? (config ? stringFromConfig(config, "controlUiUrl") : null);
  const openclaw: OpenClawDeploymentSummary | null = configuredModel && configuredProvider && configuredApiUrl && serviceUrl
    ? buildOpenClawInfo({
      allowedOrigins: config ? stringArrayFromConfig(config, "allowedOrigins") : [],
      model: configuredModel,
      modelhubApiUrl: configuredApiUrl,
      provider: configuredProvider,
      serviceUrl,
    })
    : null;

  return {
    connectionId: deployment.connectionId,
    createdAt: serializeDate(deployment.createdAt),
    error: deployment.error,
    externalAppName: deployment.externalAppName,
    externalServiceId: deployment.externalServiceId,
    id: deployment.id,
    image: deployment.image,
    instanceType: deployment.instanceType,
    name: deployment.name,
    port: deployment.port,
    provider: RENDER_PROVIDER,
    publicUrl: deployment.publicUrl,
    region: deployment.region,
    status: normalizeStatus(deployment.status),
    openclaw,
    updatedAt: serializeDate(deployment.updatedAt),
  };
}

function decryptConnectionToken(connection: { token: string }): string | Response {
  try {
    return decryptCredential(connection.token);
  } catch (error) {
    console.error("[cloud/render] failed to decrypt token", error);
    return jsonErrorResponse(500, "Nao foi possivel ler o token salvo. Reconecte o Render.");
  }
}

async function getOrCreateModelhubApiKey(
  connection: { id: string; modelhubApiKey: string | null },
  userId: string,
): Promise<string> {
  if (connection.modelhubApiKey) {
    return decryptCredential(connection.modelhubApiKey);
  }

  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { key: hash, label: "openclaw-byoc", prefix, userId },
  });
  await prisma.cloudConnection.update({
    data: { modelhubApiKey: encryptCredential(raw) },
    where: { id: connection.id },
  });
  return raw;
}

app.get("/connections", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const connections = await prisma.cloudConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      externalOrganizationName: true,
      externalUserEmail: true,
      id: true,
      label: true,
      provider: true,
      updatedAt: true,
    },
    where: { userId },
  });

  return c.json({ connections: connections.map(serializeConnection) });
});

app.post("/connections/render", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => null);
  const parsed = cloudRenderConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorResponse(400, "Invalid input", {
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const token = parsed.data.token;
  let metadata;
  try {
    metadata = await validateRenderToken(token);
  } catch (error) {
    console.error("[cloud/render] token validation failed", error);
    return jsonErrorResponse(401, "Token Render invalido ou sem permissao para ler a conta.");
  }

  const connection = await prisma.cloudConnection.upsert({
    create: {
      externalOrganizationId: metadata.ownerId,
      externalOrganizationName: metadata.ownerName,
      externalUserEmail: metadata.ownerEmail,
      externalUserId: null,
      label: parsed.data.label ?? "Render",
      provider: RENDER_PROVIDER,
      token: encryptCredential(token),
      userId,
    },
    select: {
      createdAt: true,
      externalOrganizationName: true,
      externalUserEmail: true,
      id: true,
      label: true,
      provider: true,
      updatedAt: true,
    },
    update: {
      externalOrganizationId: metadata.ownerId,
      externalOrganizationName: metadata.ownerName,
      externalUserEmail: metadata.ownerEmail,
      label: parsed.data.label ?? "Render",
      token: encryptCredential(token),
    },
    where: {
      userId_provider: {
        provider: RENDER_PROVIDER,
        userId,
      },
    },
  });

  return c.json({ connection: serializeConnection(connection) }, 201);
});

app.delete("/connections/:id", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const connectionId = c.req.param("id");
  const connection = await prisma.cloudConnection.findFirst({
    select: { id: true },
    where: { id: connectionId, userId },
  });
  if (!connection) return jsonErrorResponse(404, "Cloud connection not found");

  const activeDeployments = await prisma.cloudDeployment.count({
    where: { connectionId, userId },
  });
  if (activeDeployments > 0) {
    return jsonErrorResponse(400, "Remova os ambientes criados antes de desconectar o Render.");
  }

  await prisma.cloudConnection.delete({ where: { id: connectionId } });
  return c.json({ success: true });
});

app.get("/deployments", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const deployments = await prisma.cloudDeployment.findMany({
    orderBy: { createdAt: "desc" },
    where: { userId },
  });

  return c.json({ deployments: deployments.map(serializeDeployment) });
});

app.post("/deployments/render", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const connection = await prisma.cloudConnection.findFirst({
    where: { provider: RENDER_PROVIDER, userId },
  });
  if (!connection) {
    return jsonErrorResponse(400, "Conecte o Render antes de criar um ambiente.");
  }

  const activeDeploymentCount = await prisma.cloudDeployment.count({
    where: {
      provider: RENDER_PROVIDER,
      status: { in: ["provisioning", "healthy", "deleting"] },
      userId,
    },
  });
  if (activeDeploymentCount > 0) {
    return jsonErrorResponse(409, "Ja existe um ambiente Render ativo. Remova-o antes de criar outro.");
  }

  const token = decryptConnectionToken(connection);
  if (typeof token !== "string") return token;

  let created;
  try {
    created = await createRenderSpikeDeployment(token, userId);
  } catch (error) {
    console.error("[cloud/render] failed to create deployment", error);
    if (isRenderFreeTierError(error)) {
      return jsonErrorResponse(409, "Nao foi possivel criar usando somente o plano gratuito do Render.");
    }
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonErrorResponse(502, `Falha ao criar ambiente no Render: ${detail}`);
  }

  const deployment = await prisma.cloudDeployment.create({
    data: {
      connectionId: connection.id,
      error: created.error,
      externalAppId: created.ownerId,
      externalAppName: created.ownerName,
      externalDeploymentId: created.deployId,
      externalServiceId: created.serviceId,
      image: RENDER_SPIKE_REPO,
      instanceType: RENDER_SPIKE_PLAN,
      name: created.serviceName,
      port: RENDER_SPIKE_PORT,
      provider: RENDER_PROVIDER,
      publicUrl: created.publicUrl,
      region: RENDER_SPIKE_REGION,
      status: created.status,
      userId,
    },
  });

  return c.json({ deployment: serializeDeployment(deployment) }, 201);
});

const openclawDeploySchema = openClawDeploymentConfigSchema;

app.post("/deployments/render/openclaw", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => null);
  const parsed = openclawDeploySchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorResponse(400, "Selecione um provider e modelo.", {
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const { provider: selectedProvider, model: selectedModel } = parsed.data;

  const connection = await prisma.cloudConnection.findFirst({
    where: { provider: RENDER_PROVIDER, userId },
  });
  if (!connection) {
    return jsonErrorResponse(400, "Conecte o Render antes de criar um ambiente.");
  }

  const activeDeploymentCount = await prisma.cloudDeployment.count({
    where: {
      provider: RENDER_PROVIDER,
      status: { in: ["provisioning", "healthy", "deleting"] },
      userId,
    },
  });
  if (activeDeploymentCount > 0) {
    return jsonErrorResponse(409, "Ja existe um ambiente Render ativo. Remova-o antes de criar outro.");
  }

  const renderToken = decryptConnectionToken(connection);
  if (typeof renderToken !== "string") return renderToken;

  const origin = new URL(c.req.url).origin;
  const modelhubApiUrl = `${origin}/v1`;
  const allowedOrigins = parsed.data.allowedOrigins ?? [origin];

  const modelhubApiKey = await getOrCreateModelhubApiKey(connection, userId);

  let created;
  try {
    created = await createRenderOpenClawDeployment(
      renderToken,
      userId,
      modelhubApiUrl,
      modelhubApiKey,
      {
        allowedOrigins,
        model: selectedModel,
        provider: selectedProvider,
      },
    );
  } catch (error) {
    console.error("[cloud/render] failed to create OpenClaw deployment", error);
    if (isRenderFreeTierError(error)) {
      return jsonErrorResponse(409, "Nao foi possivel criar no plano gratuito. O OpenClaw pode exigir o plano Starter ($7/mes).");
    }
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonErrorResponse(502, `Falha ao criar OpenClaw no Render: ${detail}`);
  }

  const deployment = await prisma.cloudDeployment.create({
    data: {
      config: {
        allowedOrigins: created.openclaw.allowedOrigins,
        controlUiUrl: created.openclaw.controlUiUrl,
        gatewayToken: encryptCredential(created.gatewayToken),
        healthUrl: created.openclaw.healthUrl,
        model: selectedModel,
        modelhubApiUrl,
        provider: selectedProvider,
        readyUrl: created.openclaw.readyUrl,
        webSocketUrl: created.openclaw.webSocketUrl,
      },
      connectionId: connection.id,
      error: created.error,
      externalAppId: created.ownerId,
      externalAppName: created.ownerName,
      externalDeploymentId: created.deployId,
      externalServiceId: created.serviceId,
      image: RENDER_OPENCLAW_IMAGE,
      instanceType: RENDER_OPENCLAW_PLAN,
      name: created.serviceName,
      port: RENDER_OPENCLAW_PORT,
      provider: RENDER_PROVIDER,
      publicUrl: created.publicUrl,
      region: RENDER_OPENCLAW_REGION,
      status: created.status,
      userId,
    },
  });

  return c.json({
    deployment: serializeDeployment(deployment),
    gatewayToken: created.gatewayToken,
  }, 201);
});

app.get("/deployments/:id/gateway-token", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const deploymentId = c.req.param("id");
  const deployment = await prisma.cloudDeployment.findFirst({
    select: { config: true, id: true },
    where: { id: deploymentId, userId },
  });
  if (!deployment) return jsonErrorResponse(404, "Cloud deployment not found");

  const config = deployment.config as Record<string, string> | null;
  if (!config?.gatewayToken) {
    return jsonErrorResponse(404, "Este ambiente nao possui gateway token armazenado.");
  }

  try {
    const gatewayToken = decryptCredential(config.gatewayToken);
    return c.json({ gatewayToken });
  } catch {
    return jsonErrorResponse(500, "Nao foi possivel descriptografar o token. Recrie o ambiente.");
  }
});

app.patch("/deployments/:id/openclaw", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const body = await c.req.json().catch(() => null);
  const parsed = openClawDeploymentConfigSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorResponse(400, "Configuracao OpenClaw invalida.", {
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const deploymentId = c.req.param("id");
  const deployment = await prisma.cloudDeployment.findFirst({
    include: { connection: true },
    where: { id: deploymentId, userId },
  });
  if (!deployment) return jsonErrorResponse(404, "Cloud deployment not found");

  const currentConfig = objectConfig(deployment.config);
  if (!currentConfig?.gatewayToken) {
    return jsonErrorResponse(400, "Este ambiente nao possui configuracao OpenClaw gerenciada.");
  }

  const renderToken = decryptConnectionToken(deployment.connection);
  if (typeof renderToken !== "string") return renderToken;

  let gatewayToken: string;
  try {
    gatewayToken = decryptCredential(String(currentConfig.gatewayToken));
  } catch {
    return jsonErrorResponse(500, "Nao foi possivel descriptografar o token do gateway. Recrie o ambiente.");
  }

  const modelhubApiUrl = stringFromConfig(currentConfig, "modelhubApiUrl") ?? `${new URL(c.req.url).origin}/v1`;
  const serviceUrl = deployment.publicUrl ?? stringFromConfig(currentConfig, "controlUiUrl");
  if (!serviceUrl) {
    return jsonErrorResponse(409, "A URL publica do Render ainda nao esta disponivel. Atualize o status e tente novamente.");
  }

  const modelhubApiKey = await getOrCreateModelhubApiKey(deployment.connection, userId);

  let updatedOpenClaw;
  try {
    updatedOpenClaw = await updateRenderOpenClawDeployment(
      renderToken,
      deployment.externalServiceId,
      gatewayToken,
      modelhubApiUrl,
      modelhubApiKey,
      {
        allowedOrigins: parsed.data.allowedOrigins,
        model: parsed.data.model,
        modelhubApiUrl,
        provider: parsed.data.provider,
        serviceUrl,
      },
    );
  } catch (error) {
    console.error("[cloud/render] failed to update OpenClaw config", error);
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonErrorResponse(502, `Falha ao reconfigurar OpenClaw no Render: ${detail}`);
  }

  const updated = await prisma.cloudDeployment.update({
    data: {
      config: {
        allowedOrigins: updatedOpenClaw.openclaw.allowedOrigins,
        controlUiUrl: updatedOpenClaw.openclaw.controlUiUrl,
        gatewayToken: String(currentConfig.gatewayToken),
        healthUrl: updatedOpenClaw.openclaw.healthUrl,
        model: updatedOpenClaw.openclaw.model,
        modelhubApiUrl,
        provider: updatedOpenClaw.openclaw.provider,
        readyUrl: updatedOpenClaw.openclaw.readyUrl,
        webSocketUrl: updatedOpenClaw.openclaw.webSocketUrl,
      },
      error: null,
      externalDeploymentId: updatedOpenClaw.deployId ?? deployment.externalDeploymentId,
      status: "provisioning",
    },
    where: { id: deployment.id },
  });

  return c.json({ deployment: serializeDeployment(updated) });
});

app.post("/deployments/:id/refresh", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const deploymentId = c.req.param("id");
  const deployment = await prisma.cloudDeployment.findFirst({
    include: { connection: true },
    where: { id: deploymentId, userId },
  });
  if (!deployment) return jsonErrorResponse(404, "Cloud deployment not found");

  const token = decryptConnectionToken(deployment.connection);
  if (typeof token !== "string") return token;

  try {
    const refresh = await refreshRenderDeployment(token, deployment.externalServiceId, deployment.externalDeploymentId);
    if (refresh.missing) {
      await prisma.cloudDeployment.delete({ where: { id: deployment.id } });
      return c.json({ deleted: true, deployment: null });
    }

    const updated = await prisma.cloudDeployment.update({
      data: {
        error: refresh.error,
        externalDeploymentId: refresh.deployId,
        publicUrl: refresh.publicUrl ?? deployment.publicUrl,
        status: refresh.status,
      },
      where: { id: deployment.id },
    });
    return c.json({ deleted: false, deployment: serializeDeployment(updated) });
  } catch (error) {
    console.error("[cloud/render] failed to refresh deployment", error);
    const updated = await prisma.cloudDeployment.update({
      data: {
        error: `Falha ao atualizar: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        status: "failed",
      },
      where: { id: deployment.id },
    });
    return jsonErrorResponse(502, `Falha ao atualizar status no Render: ${error instanceof Error ? error.message : "Erro desconhecido"}`, {
      deployment: serializeDeployment(updated),
    });
  }
});

app.delete("/deployments/:id", async (c) => {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const deploymentId = c.req.param("id");
  const deployment = await prisma.cloudDeployment.findFirst({
    include: { connection: true },
    where: { id: deploymentId, userId },
  });
  if (!deployment) return jsonErrorResponse(404, "Cloud deployment not found");

  const token = decryptConnectionToken(deployment.connection);
  if (typeof token !== "string") return token;

  await prisma.cloudDeployment.update({
    data: { error: null, status: "deleting" },
    where: { id: deployment.id },
  });

  try {
    await deleteRenderService(token, deployment.externalServiceId);
    await prisma.cloudDeployment.delete({ where: { id: deployment.id } });
    return c.json({ success: true });
  } catch (error) {
    console.error("[cloud/render] failed to delete deployment", error);
    const updated = await prisma.cloudDeployment.update({
      data: {
        error: `Falha ao remover: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        status: deployment.status,
      },
      where: { id: deployment.id },
    });
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonErrorResponse(502, `Falha ao remover ambiente no Render: ${detail}`, {
      deployment: serializeDeployment(updated),
    });
  }
});

export default app.fetch;
