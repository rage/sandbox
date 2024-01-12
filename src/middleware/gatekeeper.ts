import { CustomContext } from "../types"
import { cpus } from "os"
import { SandboxBusyError } from "../util/error"

export const INSTANCES = cpus().length
let busyInstances = 0
let memoryReserved = 0

export function getBusyInstances(): number {
  return busyInstances
}

export function freeInstance(): void {
  busyInstances--
}

function reserveInstance(memory: number) {
  busyInstances++
  memoryReserved += memory
}

// Enforces the server is not processing too many submissions at once.
const gateKeeper = async (
  ctx: CustomContext,
  next: () => Promise<unknown>,
): Promise<void> => {
  if (busyInstances >= INSTANCES) {
    throw new SandboxBusyError()
  }
  // TODO: Memory amount depends on sandbox (16gb or 32gb)
  if (memoryReserved + ctx.request.body.memory > 1) {
    throw new SandboxBusyError()
  }
  reserveInstance(ctx.request.body.memory)
  await next()
}

export default gateKeeper
