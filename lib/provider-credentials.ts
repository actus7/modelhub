import type { ProviderCredentialSummary, UiProvider } from "@/lib/contracts";

function providerCredentialKeys(
  provider: UiProvider | null | undefined,
): string[] {
  return provider?.requiredKeys?.map((field) => field.envName) ?? [];
}

export function providerAuthMode(provider: UiProvider | null | undefined) {
  if (provider?.runtime?.authMode) {
    return provider.runtime.authMode;
  }

  return providerCredentialKeys(provider).length > 0 ? "api-key" : "none";
}

export function providerUsesStoredCredentials(provider: UiProvider | null | undefined): boolean {
  return providerAuthMode(provider) === "api-key";
}

export function providerUsesBrowserSession(provider: UiProvider | null | undefined): boolean {
  return providerAuthMode(provider) === "browser-session";
}

export function providerSupportsExternalApi(provider: UiProvider | null | undefined): boolean {
  if (typeof provider?.runtime?.externalApi === "boolean") {
    return provider.runtime.externalApi;
  }

  return provider?.runtime?.kind !== "client";
}

export function providerHasRequiredCredentials(
  provider: UiProvider | null | undefined,
  credentials: ProviderCredentialSummary[],
): boolean {
  if (providerAuthMode(provider) !== "api-key") {
    return true;
  }

  const requiredKeys = providerCredentialKeys(provider);
  if (requiredKeys.length === 0) {
    return true;
  }

  const available = new Set(
    credentials
      .filter((credential) => credential.providerId === provider?.id)
      .map((credential) => credential.credentialKey),
  );

  return requiredKeys.every((key) => available.has(key));
}

export function sortProvidersByConfiguredCredentials(
  providers: UiProvider[],
  credentials: ProviderCredentialSummary[],
): UiProvider[] {
  return [...providers].sort((a, b) => {
    const aConfigured = providerHasRequiredCredentials(a, credentials);
    const bConfigured = providerHasRequiredCredentials(b, credentials);

    if (aConfigured === bConfigured) {
      return 0;
    }

    return aConfigured ? -1 : 1;
  });
}

export function providerCredentialIds(
  providerId: string,
  credentials: ProviderCredentialSummary[],
): string[] {
  return credentials
    .filter((credential) => credential.providerId === providerId)
    .map((credential) => credential.id);
}
