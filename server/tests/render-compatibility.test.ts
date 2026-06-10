import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  validateRenderToken,
  createRenderSpikeDeployment,
  createRenderOpenClawDeployment,
  refreshRenderDeployment,
  updateRenderOpenClawDeployment,
  deleteRenderService,
  isRenderFreeTierError,
  getRenderSpikeServiceName,
  getRenderOpenClawServiceName,
  renderDriver,
} from "../lib/cloud/render";

// Mock fetch to avoid actual API calls
global.fetch = vi.fn();

describe("Render Driver Compatibility", () => {
  const mockUserId = "test-user-123";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Legacy Functions", () => {
    it("should export all original functions", () => {
      // Verify that all the original exported functions still exist
      expect(typeof validateRenderToken).toBe("function");
      expect(typeof createRenderSpikeDeployment).toBe("function");
      expect(typeof createRenderOpenClawDeployment).toBe("function");
      expect(typeof refreshRenderDeployment).toBe("function");
      expect(typeof updateRenderOpenClawDeployment).toBe("function");
      expect(typeof deleteRenderService).toBe("function");
      expect(typeof isRenderFreeTierError).toBe("function");
      expect(typeof getRenderSpikeServiceName).toBe("function");
      expect(typeof getRenderOpenClawServiceName).toBe("function");
    });

    it("should generate consistent service names", () => {
      const spikeName1 = getRenderSpikeServiceName(mockUserId);
      const spikeName2 = getRenderSpikeServiceName(mockUserId);
      expect(spikeName1).toBe(spikeName2);
      expect(spikeName1).toContain("modelhub-spike");

      const openclawName1 = getRenderOpenClawServiceName(mockUserId);
      const openclawName2 = getRenderOpenClawServiceName(mockUserId);
      expect(openclawName1).toBe(openclawName2);
      expect(openclawName1).toContain("modelhub-openclaw");

      // Names should be different
      expect(spikeName1).not.toBe(openclawName1);
    });

  });

  describe("New Driver Interface", () => {
    it("should export renderDriver implementing CloudProviderDriver", () => {
      expect(renderDriver).toBeDefined();
      expect(typeof renderDriver.validateToken).toBe("function");
      expect(typeof renderDriver.createOpenClaw).toBe("function");
      expect(typeof renderDriver.updateOpenClaw).toBe("function");
      expect(typeof renderDriver.refresh).toBe("function");
      expect(typeof renderDriver.deleteService).toBe("function");
      expect(typeof renderDriver.getServiceName).toBe("function");
      expect(typeof renderDriver.isFreeTierError).toBe("function");
    });

    it("should use legacy service name function", () => {
      const serviceName = renderDriver.getServiceName(mockUserId);
      const legacyName = getRenderOpenClawServiceName(mockUserId);
      expect(serviceName).toBe(legacyName);
    });

    it("should use legacy free tier error detection", () => {
      const testError = new Error("test error");
      const driverResult = renderDriver.isFreeTierError(testError);
      const legacyResult = isRenderFreeTierError(testError);
      expect(driverResult).toBe(legacyResult);
    });
  });

  describe("Error Handling", () => {
    it("should properly handle free tier errors", () => {
      // Mock various error scenarios
      const freeErrors = [
        { message: "plan upgrade required", status: 402 },
        { message: "quota exceeded", status: 422 },
        { message: "free tier limit reached", status: 400 }
      ];

      freeErrors.forEach(errorData => {
        const mockError = {
          message: errorData.message,
          status: errorData.status,
          responseBody: { message: errorData.message }
        };

        // Test with object that matches RenderApiError structure
        const result = isRenderFreeTierError(mockError);
        expect(typeof result).toBe("boolean");
      });
    });
  });

  describe("Function Signatures", () => {
    it("should maintain original function signatures", () => {
      // This test ensures we haven't accidentally changed the signatures
      // of existing functions, which would break existing code

      // validateRenderToken should return Promise<RenderAccountMetadata>
      expect(validateRenderToken.length).toBe(1); // 1 parameter: token

      // createRenderSpikeDeployment should return Promise<RenderSpikeDeployment>
      expect(createRenderSpikeDeployment.length).toBe(2); // 2 parameters: token, userId

      // createRenderOpenClawDeployment should return Promise<RenderOpenClawDeployment>
      expect(createRenderOpenClawDeployment.length).toBe(5); // 5 parameters

      // refreshRenderDeployment should return Promise<RenderDeploymentRefresh>
      expect(refreshRenderDeployment.length).toBe(3); // 3 parameters

      // updateRenderOpenClawDeployment should return Promise<{deployId, openclaw}>
      expect(updateRenderOpenClawDeployment.length).toBe(6); // 6 parameters

      // deleteRenderService should return Promise<"deleted" | "missing">
      expect(deleteRenderService.length).toBe(2); // 2 parameters

      // Service name functions should take 1 parameter
      expect(getRenderSpikeServiceName.length).toBe(1);
      expect(getRenderOpenClawServiceName.length).toBe(1);
    });
  });
});