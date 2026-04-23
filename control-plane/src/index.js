import { fileURLToPath } from "node:url";

import {
  createControlPlaneApplication,
  startControlPlaneServer,
} from "../../packages/stx/src/application.js";

export { createControlPlaneApplication };

async function start() {
  const application = await startControlPlaneServer();
  process.stdout.write(
    `${JSON.stringify({
      status: "listening",
      host: application.host,
      port: application.port,
      dataDir: application.dataDir,
      uiDir: application.uiDir,
    })}\n`,
  );
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entryPath) {
  start().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
