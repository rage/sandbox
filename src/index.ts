import { buildApp } from "./app.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
if (Number.isNaN(PORT)) {
  throw new Error(`Invalid PORT value "${process.env["PORT"] ?? ""}": must be a number`);
}
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function start(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Sandbox server running at http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
