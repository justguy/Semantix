import { buildUi } from "../src/ui/build.js";

process.stdout.write(`${JSON.stringify(await buildUi())}\n`);
