export interface ResourceLimits {
  memoryGB: number
  cpus: number
}

const MAX_MEMORY_REQUEST_GB = 4
const MAX_CPUS_REQUEST = 2

/** Extracts and validatates cpu and memory requests. Handles too big requests by making them smaller. */
export default function extractResourceLimitsFromRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  requestBody: any,
): ResourceLimits {
  let memoryGB = Number(requestBody.memory_limit_gb ?? 1)
  let cpus = Number(requestBody.cpu_limit ?? 1)
  if (memoryGB > MAX_MEMORY_REQUEST_GB) {
    memoryGB = MAX_MEMORY_REQUEST_GB
  }
  if (cpus > MAX_CPUS_REQUEST) {
    cpus = MAX_CPUS_REQUEST
  }
  return { memoryGB, cpus }
}
