import { execFile as execFileCallback } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";
import { ALLOWED_ALTERNATIVE_DOCKER_IMAGES } from "../schemas.js";

const REGISTRY_CHILDREN_URL = "https://eu.gcr.io/v2/moocfi-public/tags/list";
const REGISTRY_BASE = "eu.gcr.io/moocfi-public/";
const IMAGE_NAME_PREFIX = "tmc-sandbox-";
const PULL_INTERVAL_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

interface DockerImageMaintenanceOptions {
  execFileFn?: ExecFileFn;
  fetchFn?: typeof fetch;
  pullIntervalMs?: number;
  pruneIntervalMs?: number;
}

function defaultExecFile(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function imageRepositoryForChild(child: string): string {
  return `${REGISTRY_BASE}${child}`;
}

async function listRegistrySandboxImages(fetchFn: typeof fetch): Promise<string[]> {
  const response = await fetchFn(REGISTRY_CHILDREN_URL);
  if (!response.ok) {
    throw new Error(`Could not list sandbox images: HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  const child = body && typeof body === "object" ? (body as { child?: unknown }).child : undefined;
  if (!Array.isArray(child)) return [];

  return child
    .filter((image): image is string => typeof image === "string")
    .filter((image) => image.startsWith(IMAGE_NAME_PREFIX))
    .map(imageRepositoryForChild);
}

async function pullImage(
  image: string,
  logger: FastifyBaseLogger,
  execFileFn: ExecFileFn,
): Promise<void> {
  logger.info({ image }, "Pulling sandbox image");
  try {
    await execFileFn("docker", ["pull", image]);
  } catch (error) {
    logger.error({ image, error }, "Could not pull sandbox image");
  }
}

export async function pullAllowedDockerImages(
  logger: FastifyBaseLogger,
  opts: Pick<DockerImageMaintenanceOptions, "execFileFn" | "fetchFn"> = {},
): Promise<void> {
  const execFileFn = opts.execFileFn ?? defaultExecFile;
  const fetchFn = opts.fetchFn ?? fetch;
  const registryImages = await listRegistrySandboxImages(fetchFn);
  const images = new Set([...ALLOWED_ALTERNATIVE_DOCKER_IMAGES, ...registryImages]);

  await Promise.all([...images].map((image) => pullImage(image, logger, execFileFn)));
}

async function pruneOldDockerImages(
  logger: FastifyBaseLogger,
  execFileFn: ExecFileFn,
): Promise<void> {
  logger.info("Pruning sandbox images that have not been used for 24 hours");
  try {
    await execFileFn("docker", ["image", "prune", "-a", "-f", "--filter", "until=24h"]);
  } catch (error) {
    logger.error({ error }, "Could not prune old sandbox images");
  }
}

export function startDockerImageMaintenance(
  logger: FastifyBaseLogger,
  opts: DockerImageMaintenanceOptions = {},
): () => void {
  const execFileFn = opts.execFileFn ?? defaultExecFile;
  const pullIntervalMs = opts.pullIntervalMs ?? PULL_INTERVAL_MS;
  const pruneIntervalMs = opts.pruneIntervalMs ?? PRUNE_INTERVAL_MS;
  let pullRunning = false;
  const pullOptions: Pick<DockerImageMaintenanceOptions, "execFileFn" | "fetchFn"> = {
    execFileFn,
  };
  if (opts.fetchFn) {
    pullOptions.fetchFn = opts.fetchFn;
  }

  const runPull = (): void => {
    if (pullRunning) return;
    pullRunning = true;
    void pullAllowedDockerImages(logger, pullOptions)
      .catch((error: unknown) => {
        logger.error({ error }, "Could not refresh allowed sandbox images");
      })
      .finally(() => {
        pullRunning = false;
      });
  };

  runPull();

  const pullInterval = setInterval(runPull, pullIntervalMs);
  const pruneInterval = setInterval(() => {
    void pruneOldDockerImages(logger, execFileFn).then(runPull);
  }, pruneIntervalMs);

  return () => {
    clearInterval(pullInterval);
    clearInterval(pruneInterval);
  };
}
