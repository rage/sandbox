import { CustomContext } from "../types"
import { cpus } from "os"
import { SandboxBusyError } from "../util/error"

export const INSTANCES = cpus().length
let busyInstances = 0

export function getBusyInstances() {
  return busyInstances
}

export function freeInstance() {
  busyInstances--
}

function reserveInstance() {
  busyInstances++
}

// Enforces the server is not processing too many submissions at once.
const gateKeeper = async (ctx: CustomContext, next: () => Promise<any>) => {
  if (busyInstances >= INSTANCES) {
    throw new SandboxBusyError()
  }
  reserveInstance()
  await next()
}

export default gateKeeper
