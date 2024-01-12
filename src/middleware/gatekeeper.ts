import { CustomContext } from "../types"
import { cpus, totalmem } from "os"
import { SandboxBusyError } from "../util/error"
import extractResourceLimitsFromRequest, {
  ResourceLimits,
} from "../util/extractResourceLimitsFromRequest"

export const CPU_CORES_IN_SYSTEM = cpus().length
export const TOTAL_SYSTEM_MEMORY_GB = totalmem() / 1024 ** 3

let reservedCPUCores = 0
let reservedMemory = 0

export function getBusyInstances(): number {
  return reservedCPUCores
}

export function getReservedMemory(): number {
  return reservedMemory
}

export function freeInstance(limits: ResourceLimits): void {
  reservedCPUCores -= limits.cpus
  reservedMemory -= limits.memoryGB
}

function reserveInstance(limits: ResourceLimits): void {
  reservedCPUCores += limits.cpus
  reservedMemory += limits.memoryGB
}

// Enforces the server is not processing too many submissions at once.
const gateKeeper = async (
  ctx: CustomContext,
  next: () => Promise<unknown>,
): Promise<void> => {
  const limits = extractResourceLimitsFromRequest(ctx.request.body)
  console.info(
    `Sandbox sumbission requesting ${limits.memoryGB}GB of memory and ${limits.cpus} CPUs`,
  )
  if (reservedCPUCores + limits.cpus >= CPU_CORES_IN_SYSTEM) {
    throw new SandboxBusyError()
  }
  if (reservedMemory + limits.memoryGB >= TOTAL_SYSTEM_MEMORY_GB) {
    throw new SandboxBusyError()
  }
  reserveInstance(limits)
  await next()
}

export default gateKeeper
