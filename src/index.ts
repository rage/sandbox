import { buildApp } from "./app.js";
import { startDockerImageMaintenance } from "./services/docker-image-maintenance.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
if (Number.isNaN(PORT)) {
  throw new Error(`Invalid PORT value "${process.env["PORT"] ?? ""}": must be a number`);
}
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function start(): Promise<void> {
  const app = await buildApp();
  let stopDockerImageMaintenance: (() => void) | undefined;
  app.addHook("onClose", () => {
    stopDockerImageMaintenance?.();
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    stopDockerImageMaintenance = startDockerImageMaintenance(app.log);
    app.log.info(`Sandbox server running at http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.fatal({ error }, "Server failed to start");
    process.exit(1);
  }
}

void start();
