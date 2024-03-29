import { CustomContext } from "../types"
import { cpus } from "os"
import { SandboxBusyError } from "../util/error"

export const INSTANCES = cpus().length
let busyInstances = 0

export function getBusyInstances(): number {
  return busyInstances
}

export function freeInstance(): void {
  busyInstances--
}

function reserveInstance() {
  busyInstances++
}

// Enforces the server is not processing too many submissions at once.
const gateKeeper = async (
  ctx: CustomContext,
  next: () => Promise<unknown>,
): Promise<void> => {
  if (busyInstances >= INSTANCES) {
    throw new SandboxBusyError()
  }
  reserveInstance()
  await next()
}

export default gateKeeper
