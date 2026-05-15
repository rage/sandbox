import { cpus, totalmem } from "node:os";
import type { ResourceLimits } from "../types.js";

export const TOTAL_CPU_CORES = cpus().length;
export const TOTAL_MEMORY_GB = totalmem() / 1024 ** 3;

let busyInstances = 0;
let reservedCpuCores = 0;
let reservedMemoryGb = 0;

export function resetState(): void {
  busyInstances = 0;
  reservedCpuCores = 0;
  reservedMemoryGb = 0;
}

export function getBusyInstances(): number {
  return busyInstances;
}

export function getReservedCpuCores(): number {
  return reservedCpuCores;
}

export function getReservedMemory(): number {
  return reservedMemoryGb;
}

export function releaseResources(limits: ResourceLimits): void {
  busyInstances = Math.max(0, busyInstances - 1);
  reservedCpuCores = Math.max(0, reservedCpuCores - limits.cpus);
  reservedMemoryGb = Math.max(0, reservedMemoryGb - limits.memoryGB);
}

function hasAvailableResources(limits: ResourceLimits): boolean {
  return (
    reservedCpuCores + limits.cpus <= TOTAL_CPU_CORES &&
    reservedMemoryGb + limits.memoryGB <= TOTAL_MEMORY_GB
  );
}

function reserveResources(limits: ResourceLimits): void {
  busyInstances++;
  reservedCpuCores += limits.cpus;
  reservedMemoryGb += limits.memoryGB;
}

// Atomically checks availability and reserves in one synchronous operation,
// preventing TOCTOU races between concurrent requests.
export function tryReserveResources(limits: ResourceLimits): boolean {
  if (!hasAvailableResources(limits)) return false;
  reserveResources(limits);
  return true;
}

export function tryResizeReservedResources(
  currentLimits: ResourceLimits,
  nextLimits: ResourceLimits,
): boolean {
  const additionalLimits: ResourceLimits = {
    cpus: Math.max(0, nextLimits.cpus - currentLimits.cpus),
    memoryGB: Math.max(0, nextLimits.memoryGB - currentLimits.memoryGB),
  };

  if (!hasAvailableResources(additionalLimits)) return false;

  // busyInstances count doesn't change on resize — only the resource amounts do.
  reservedCpuCores += nextLimits.cpus - currentLimits.cpus;
  reservedMemoryGb += nextLimits.memoryGB - currentLimits.memoryGB;
  return true;
}

export function getResourceUtilization(): { cpuUtilization: number; memoryUtilization: number } {
  return {
    cpuUtilization: reservedCpuCores / TOTAL_CPU_CORES,
    memoryUtilization: reservedMemoryGb / TOTAL_MEMORY_GB,
  };
}
