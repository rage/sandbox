import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as resourceManager from "./resource-manager.js";

describe("ResourceManager", () => {
  beforeEach(() => {
    resourceManager.resetState();
  });

  afterEach(() => {
    resourceManager.resetState();
  });

  describe("initial state", () => {
    it("should start with zero reserved resources", () => {
      expect(resourceManager.getBusyInstances()).toBe(0);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
    });

    it("should have positive total system resources", () => {
      expect(resourceManager.TOTAL_CPU_CORES).toBeGreaterThan(0);
      expect(resourceManager.TOTAL_MEMORY_GB).toBeGreaterThan(0);
    });
  });

  describe("resource reservation", () => {
    it("should reserve single resource allocation", () => {
      const limits = { cpus: 1, memoryGB: 1 };
      expect(resourceManager.tryReserveResources(limits)).toBe(true);

      expect(resourceManager.getBusyInstances()).toBe(1);
      expect(resourceManager.getReservedCpuCores()).toBe(1);
      expect(resourceManager.getReservedMemory()).toBe(1);
    });

    it("should accumulate multiple reservations", () => {
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
      expect(resourceManager.tryReserveResources({ cpus: 0.5, memoryGB: 0.5 })).toBe(true);

      expect(resourceManager.getBusyInstances()).toBe(2);
      expect(resourceManager.getReservedCpuCores()).toBe(1.5);
      expect(resourceManager.getReservedMemory()).toBe(1.5);
    });

    it("should release resources correctly", () => {
      const limits = { cpus: 1, memoryGB: 1 };
      expect(resourceManager.tryReserveResources(limits)).toBe(true);
      resourceManager.releaseResources(limits);

      expect(resourceManager.getBusyInstances()).toBe(0);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
    });

    it("should handle partial release", () => {
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
      expect(resourceManager.tryReserveResources({ cpus: 0.5, memoryGB: 0.5 })).toBe(true);
      resourceManager.releaseResources({ cpus: 0.5, memoryGB: 0.5 });

      expect(resourceManager.getBusyInstances()).toBe(1);
      expect(resourceManager.getReservedCpuCores()).toBe(1);
      expect(resourceManager.getReservedMemory()).toBe(1);
    });

    it("should handle fractional CPU allocations", () => {
      expect(resourceManager.tryReserveResources({ cpus: 0.25, memoryGB: 0.5 })).toBe(true);
      expect(resourceManager.tryReserveResources({ cpus: 0.75, memoryGB: 0.25 })).toBe(true);

      expect(resourceManager.getBusyInstances()).toBe(2);
      expect(resourceManager.getReservedCpuCores()).toBe(1);
      expect(resourceManager.getReservedMemory()).toBe(0.75);
    });

    it("should allow multiple small reservations", () => {
      for (let i = 0; i < 10; i++) {
        expect(resourceManager.tryReserveResources({ cpus: 0.1, memoryGB: 0.1 })).toBe(true);
      }
      expect(resourceManager.getBusyInstances()).toBe(10);
      expect(resourceManager.getReservedCpuCores()).toBeCloseTo(1, 10);
      expect(resourceManager.getReservedMemory()).toBeCloseTo(1, 10);
    });
  });

  describe("availability checking", () => {
    it("should allow small allocations", () => {
      const limits = { cpus: 0.1, memoryGB: 0.1 };
      expect(resourceManager.tryReserveResources(limits)).toBe(true);
    });

    it("should prevent exceeding CPU limit", () => {
      const reserve = {
        cpus: resourceManager.TOTAL_CPU_CORES - 0.1,
        memoryGB: 0,
      };
      expect(resourceManager.tryReserveResources(reserve)).toBe(true);

      const request = { cpus: 1, memoryGB: 0 };
      expect(resourceManager.tryReserveResources(request)).toBe(false);
    });

    it("should prevent exceeding memory limit", () => {
      const reserve = {
        cpus: 0,
        memoryGB: resourceManager.TOTAL_MEMORY_GB - 0.1,
      };
      expect(resourceManager.tryReserveResources(reserve)).toBe(true);

      const request = { cpus: 0, memoryGB: 1 };
      expect(resourceManager.tryReserveResources(request)).toBe(false);
    });

    it("should allow exact match of available resources", () => {
      const reserve = {
        cpus: resourceManager.TOTAL_CPU_CORES - 1,
        memoryGB: resourceManager.TOTAL_MEMORY_GB - 1,
      };
      expect(resourceManager.tryReserveResources(reserve)).toBe(true);

      const request = { cpus: 1, memoryGB: 1 };
      expect(resourceManager.tryReserveResources(request)).toBe(true);
    });

    it("should reject when both CPU and memory exceed limits", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: resourceManager.TOTAL_CPU_CORES - 0.1,
          memoryGB: resourceManager.TOTAL_MEMORY_GB - 0.1,
        }),
      ).toBe(true);

      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(false);
    });

    it("should reject when CPU limit exceeded but memory ok", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: resourceManager.TOTAL_CPU_CORES - 0.1,
          memoryGB: 0,
        }),
      ).toBe(true);

      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 0.5 })).toBe(false);
    });

    it("should reject when memory limit exceeded but CPU ok", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: 0,
          memoryGB: resourceManager.TOTAL_MEMORY_GB - 0.1,
        }),
      ).toBe(true);

      expect(resourceManager.tryReserveResources({ cpus: 0.5, memoryGB: 1 })).toBe(false);
    });
  });

  describe("utilization reporting", () => {
    it("should report zero utilization initially", () => {
      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBe(0);
      expect(util.memoryUtilization).toBe(0);
    });

    it("should report correct CPU utilization", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: resourceManager.TOTAL_CPU_CORES / 2,
          memoryGB: 0,
        }),
      ).toBe(true);

      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBe(0.5);
      expect(util.memoryUtilization).toBe(0);
    });

    it("should report correct memory utilization", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: 0,
          memoryGB: resourceManager.TOTAL_MEMORY_GB / 4,
        }),
      ).toBe(true);

      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBe(0);
      expect(util.memoryUtilization).toBe(0.25);
    });

    it("should report combined utilization", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: resourceManager.TOTAL_CPU_CORES / 2,
          memoryGB: resourceManager.TOTAL_MEMORY_GB / 4,
        }),
      ).toBe(true);

      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBe(0.5);
      expect(util.memoryUtilization).toBe(0.25);
    });

    it("should report full utilization", () => {
      expect(
        resourceManager.tryReserveResources({
          cpus: resourceManager.TOTAL_CPU_CORES,
          memoryGB: resourceManager.TOTAL_MEMORY_GB,
        }),
      ).toBe(true);

      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBe(1);
      expect(util.memoryUtilization).toBe(1);
    });

    it("should handle very small allocations in utilization", () => {
      expect(resourceManager.tryReserveResources({ cpus: 0.01, memoryGB: 0.01 })).toBe(true);

      const util = resourceManager.getResourceUtilization();
      expect(util.cpuUtilization).toBeGreaterThan(0);
      expect(util.memoryUtilization).toBeGreaterThan(0);
      expect(util.cpuUtilization).toBeLessThan(0.1);
      expect(util.memoryUtilization).toBeLessThan(0.1);
    });
  });

  describe("corner cases", () => {
    it("clamps to zero on over-release instead of going negative", () => {
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
      resourceManager.releaseResources({ cpus: 2, memoryGB: 2 });

      expect(resourceManager.getBusyInstances()).toBe(0);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
    });

    it("clamps to zero on release with no prior reservation", () => {
      resourceManager.releaseResources({ cpus: 1, memoryGB: 1 });

      expect(resourceManager.getBusyInstances()).toBe(0);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
    });

    it("does not allow negative state to cause spurious availability", () => {
      // Over-release must clamp to 0, not go negative (which would fake free capacity).
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
      resourceManager.releaseResources({ cpus: 2, memoryGB: 2 });

      // Resources should still show as available (clamped to 0, not -1).
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
    });

    it("should handle many small consecutive allocations", () => {
      for (let i = 0; i < 100; i++) {
        expect(resourceManager.tryReserveResources({ cpus: 0.01, memoryGB: 0.01 })).toBe(true);
      }

      expect(resourceManager.getBusyInstances()).toBe(100);
      expect(resourceManager.getReservedCpuCores()).toBeCloseTo(1, 10);
      expect(resourceManager.getReservedMemory()).toBeCloseTo(1, 10);
    });

    it("should handle release and re-reserve cycle", () => {
      const limits = { cpus: 1, memoryGB: 1 };

      for (let i = 0; i < 5; i++) {
        expect(resourceManager.tryReserveResources(limits)).toBe(true);
        expect(resourceManager.getBusyInstances()).toBe(1);
        expect(resourceManager.getReservedCpuCores()).toBe(1);
        resourceManager.releaseResources(limits);
        expect(resourceManager.getBusyInstances()).toBe(0);
        expect(resourceManager.getReservedCpuCores()).toBe(0);
      }
    });

    it("should maintain accuracy with floating point operations", () => {
      expect(resourceManager.tryReserveResources({ cpus: 0.1, memoryGB: 0.1 })).toBe(true);
      expect(resourceManager.tryReserveResources({ cpus: 0.2, memoryGB: 0.2 })).toBe(true);
      expect(resourceManager.tryReserveResources({ cpus: 0.3, memoryGB: 0.3 })).toBe(true);
      resourceManager.releaseResources({ cpus: 0.1, memoryGB: 0.1 });

      expect(resourceManager.getBusyInstances()).toBe(2);
      expect(resourceManager.getReservedCpuCores()).toBeLessThanOrEqual(0.51);
      expect(resourceManager.getReservedCpuCores()).toBeGreaterThanOrEqual(0.39);
      expect(resourceManager.getReservedMemory()).toBeLessThanOrEqual(0.51);
      expect(resourceManager.getReservedMemory()).toBeGreaterThanOrEqual(0.39);
    });

    it("should handle zero-value resources", () => {
      expect(resourceManager.tryReserveResources({ cpus: 0, memoryGB: 0 })).toBe(true);

      expect(resourceManager.getBusyInstances()).toBe(1);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
      // Capacity should still be available since zero was reserved.
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
    });
  });

  describe("tryReserveResources", () => {
    it("reserves and returns true when resources are available", () => {
      const limits = { cpus: 1, memoryGB: 1 };
      const result = resourceManager.tryReserveResources(limits);

      expect(result).toBe(true);
      expect(resourceManager.getBusyInstances()).toBe(1);
      expect(resourceManager.getReservedCpuCores()).toBe(1);
      expect(resourceManager.getReservedMemory()).toBe(1);
    });

    it("returns false and does not reserve when CPU is exhausted", () => {
      expect(
        resourceManager.tryReserveResources({ cpus: resourceManager.TOTAL_CPU_CORES, memoryGB: 0 }),
      ).toBe(true);

      const result = resourceManager.tryReserveResources({ cpus: 0.1, memoryGB: 0 });

      expect(result).toBe(false);
      expect(resourceManager.getBusyInstances()).toBe(1);
    });

    it("returns false and does not reserve when memory is exhausted", () => {
      expect(
        resourceManager.tryReserveResources({ cpus: 0, memoryGB: resourceManager.TOTAL_MEMORY_GB }),
      ).toBe(true);

      const result = resourceManager.tryReserveResources({ cpus: 0, memoryGB: 0.1 });

      expect(result).toBe(false);
      expect(resourceManager.getBusyInstances()).toBe(1);
    });

    it("does not double-count on rejection — state unchanged", () => {
      expect(
        resourceManager.tryReserveResources({ cpus: resourceManager.TOTAL_CPU_CORES, memoryGB: 0 }),
      ).toBe(true);
      const before = resourceManager.getReservedCpuCores();

      resourceManager.tryReserveResources({ cpus: 1, memoryGB: 0 });

      expect(resourceManager.getReservedCpuCores()).toBe(before);
    });
  });

  describe("state reset", () => {
    it("should clear all reserved resources on reset", () => {
      expect(resourceManager.tryReserveResources({ cpus: 1, memoryGB: 1 })).toBe(true);
      resourceManager.resetState();

      expect(resourceManager.getBusyInstances()).toBe(0);
      expect(resourceManager.getReservedCpuCores()).toBe(0);
      expect(resourceManager.getReservedMemory()).toBe(0);
    });
  });
});
