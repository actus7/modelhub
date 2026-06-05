import type { UiProvider } from "@/lib/contracts";
import { apiJsonRequest, testProviderCredentials } from "@/lib/api";

export async function saveProviderCredentials(
  provider: UiProvider,
  credentialValues: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const requiredKeys = provider.requiredKeys ?? [];

  const creds: Record<string, string> = {};
  for (const f of requiredKeys) {
    const val = credentialValues[f.envName]?.trim();
    if (!val) {
      return { ok: false, error: `A credencial "${f.label}" é obrigatória.` };
    }
    creds[f.envName] = val;
  }

  const testResult = await testProviderCredentials(provider.base, creds);
  if (!testResult.ok && !testResult.skipped) {
    return { ok: false, error: testResult.error ?? "Chave inválida. Verifique e tente novamente." };
  }

  await Promise.all(
    requiredKeys.map((field) =>
      apiJsonRequest("/user/credentials", "POST", {
        credentialKey: field.envName,
        credentialValue: credentialValues[field.envName],
        providerId: provider.id,
      }),
    ),
  );

  return { ok: true };
}
