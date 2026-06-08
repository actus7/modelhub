import type {
  CloudProvider,
  CloudProviderDriver,
  CloudProviderError,
  CloudProviderErrorType
} from "./driver";
import { renderDriver } from "./render";
import { railwayDriver } from "./railway";
import { flyioDriver } from "./flyio";

// Registry of all available cloud provider drivers
export const cloudDrivers: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  railway: railwayDriver,
  "fly.io": flyioDriver,
};

/**
 * Get a cloud provider driver by name
 * @param provider The cloud provider name
 * @returns The driver instance
 * @throws CloudProviderError if provider is not supported
 */
export function getCloudDriver(provider: CloudProvider): CloudProviderDriver {
  const driver = cloudDrivers[provider];
  if (!driver) {
    throw new CloudProviderError(
      CloudProviderErrorType.INVALID_CONFIGURATION,
      provider,
      `Driver não encontrado para provider: ${provider}`
    );
  }
  return driver;
}

/**
 * Get list of all supported cloud providers
 * @returns Array of supported provider names
 */
export function getSupportedProviders(): CloudProvider[] {
  return Object.keys(cloudDrivers) as CloudProvider[];
}

/**
 * Check if a provider is supported
 * @param provider The provider name to check
 * @returns True if supported
 */
export function isProviderSupported(provider: string): provider is CloudProvider {
  return provider in cloudDrivers;
}

// Re-export everything from driver for convenience
export * from "./driver";