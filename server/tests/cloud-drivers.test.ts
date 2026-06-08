import { describe, it, expect, beforeEach } from "vitest";

import {
  getCloudDriver,
  getSupportedProviders,
  isProviderSupported,
  type CloudProvider,
  type CloudProviderDriver,
  CloudProviderErrorType
} from "../lib/cloud";

describe("Cloud Provider Drivers", () => {
  const supportedProviders: CloudProvider[] = ["render", "railway", "fly.io"];

  describe("Registry", () => {
    it("should return all supported providers", () => {
      const providers = getSupportedProviders();
      expect(providers).toEqual(expect.arrayContaining(supportedProviders));
      expect(providers.length).toBeGreaterThanOrEqual(3);
    });

    it("should correctly identify supported providers", () => {
      expect(isProviderSupported("render")).toBe(true);
      expect(isProviderSupported("railway")).toBe(true);
      expect(isProviderSupported("fly.io")).toBe(true);
      expect(isProviderSupported("unsupported")).toBe(false);
    });

    it("should throw error for unsupported provider", () => {
      expect(() => getCloudDriver("unsupported" as CloudProvider)).toThrow();
    });
  });

  describe("Driver Interface Compliance", () => {
    supportedProviders.forEach((provider) => {
      describe(`${provider} driver`, () => {
        let driver: CloudProviderDriver;

        beforeEach(() => {
          driver = getCloudDriver(provider);
        });

        it("should have all required methods", () => {
          expect(typeof driver.validateToken).toBe("function");
          expect(typeof driver.createOpenClaw).toBe("function");
          expect(typeof driver.updateOpenClaw).toBe("function");
          expect(typeof driver.refresh).toBe("function");
          expect(typeof driver.deleteService).toBe("function");
          expect(typeof driver.getServiceName).toBe("function");
          expect(typeof driver.isFreeTierError).toBe("function");
          expect(typeof driver.getProviderLimits).toBe("function");
          expect(typeof driver.getProviderName).toBe("function");
        });

        it("should return correct provider name", () => {
          expect(driver.getProviderName()).toBe(provider);
        });

        it("should return provider limits", () => {
          const limits = driver.getProviderLimits();
          expect(limits).toHaveProperty("freeTier");
          expect(limits).toHaveProperty("rateLimits");
          expect(limits).toHaveProperty("constraints");
          expect(Array.isArray(limits.constraints)).toBe(true);
        });

        it("should generate service name for user", () => {
          const serviceName = driver.getServiceName("test-user-id");
          expect(typeof serviceName).toBe("string");
          expect(serviceName.length).toBeGreaterThan(0);
        });

        it("should handle free tier error detection", () => {
          const result = driver.isFreeTierError(new Error("test error"));
          expect(typeof result).toBe("boolean");
        });
      });
    });
  });

  describe("Error Handling", () => {
    it("should have all error types defined", () => {
      const errorTypes = Object.values(CloudProviderErrorType);
      expect(errorTypes).toContain("authentication");
      expect(errorTypes).toContain("free_tier_limit");
      expect(errorTypes).toContain("rate_limit");
      expect(errorTypes).toContain("resource_not_found");
      expect(errorTypes).toContain("resource_conflict");
      expect(errorTypes).toContain("service_unavailable");
      expect(errorTypes).toContain("invalid_configuration");
      expect(errorTypes).toContain("unknown");
    });
  });

  describe("Service Name Generation", () => {
    const testUserId = "test-user-123";

    it("should generate consistent service names for same user", () => {
      const renderName1 = getCloudDriver("render").getServiceName(testUserId);
      const renderName2 = getCloudDriver("render").getServiceName(testUserId);
      expect(renderName1).toBe(renderName2);

      const railwayName1 = getCloudDriver("railway").getServiceName(testUserId);
      const railwayName2 = getCloudDriver("railway").getServiceName(testUserId);
      expect(railwayName1).toBe(railwayName2);

      const flyioName1 = getCloudDriver("fly.io").getServiceName(testUserId);
      const flyioName2 = getCloudDriver("fly.io").getServiceName(testUserId);
      expect(flyioName1).toBe(flyioName2);
    });

    it("should generate different service names for different users", () => {
      const user1Name = getCloudDriver("render").getServiceName("user1");
      const user2Name = getCloudDriver("render").getServiceName("user2");
      expect(user1Name).not.toBe(user2Name);
    });

    it("should generate valid service names", () => {
      supportedProviders.forEach((provider) => {
        const serviceName = getCloudDriver(provider).getServiceName(testUserId);

        // Should not be empty
        expect(serviceName.length).toBeGreaterThan(0);

        // Should not contain invalid characters for most cloud providers
        expect(serviceName).toMatch(/^[a-z0-9\-]+$/);

        // Should contain some identifier
        expect(serviceName).toMatch(/(modelhub|openclaw|spike)/);
      });
    });
  });

  describe("Provider Limits", () => {
    supportedProviders.forEach((provider) => {
      it(`should have valid limits for ${provider}`, () => {
        const limits = getCloudDriver(provider).getProviderLimits();

        expect(limits.freeTier).toBeDefined();
        expect(limits.freeTier.memory).toBeDefined();
        expect(limits.freeTier.cpu).toBeDefined();

        expect(limits.rateLimits).toBeDefined();
        expect(limits.rateLimits.general).toBeDefined();

        expect(Array.isArray(limits.constraints)).toBe(true);
      });
    });
  });
});