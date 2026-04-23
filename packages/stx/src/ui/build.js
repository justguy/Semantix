import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const uiModuleDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(uiModuleDir, "..");
const packageDir = resolve(srcDir, "..");
const scriptsDir = resolve(packageDir, "scripts");
const sourceDir = resolve(packageDir, "ui");
const distDir = resolve(packageDir, "dist", "ui");

const indexTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Semantix - Control Surface</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light;
    }

    html, body, #root {
      margin: 0;
      padding: 0;
      height: 100%;
      width: 100%;
    }

    body {
      font-family: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    * {
      box-sizing: border-box;
    }

    button,
    textarea,
    input,
    select {
      font: inherit;
    }

    *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    *::-webkit-scrollbar-track {
      background: transparent;
    }

    *::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.25);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: content-box;
    }

    *::-webkit-scrollbar-thumb:hover {
      background: rgba(128, 128, 128, 0.4);
      background-clip: content-box;
      border: 2px solid transparent;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./assets/app.js"></script>
</body>
</html>
`;

export function getDefaultBuiltUiDir() {
  return distDir;
}

export async function buildUi({
  minify = false,
  sourcemap = true,
  uiDistDir = distDir,
} = {}) {
  await rm(uiDistDir, { recursive: true, force: true });
  await mkdir(join(uiDistDir, "assets"), { recursive: true });

  await build({
    absWorkingDir: packageDir,
    bundle: true,
    entryPoints: [join(sourceDir, "main.jsx")],
    format: "esm",
    inject: [join(scriptsDir, "react-inject.js")],
    jsx: "transform",
    legalComments: "none",
    loader: {
      ".jsx": "jsx",
    },
    minify,
    outfile: join(uiDistDir, "assets", "app.js"),
    platform: "browser",
    sourcemap,
    target: ["es2022"],
  });

  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  await writeFile(join(uiDistDir, "index.html"), indexTemplate, "utf8");
  await writeFile(
    join(uiDistDir, "asset-manifest.json"),
    `${JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        entrypoint: "/assets/app.js",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    status: "ok",
    uiDistDir,
    entrypoint: join(uiDistDir, "assets", "app.js"),
    manifestPath: join(uiDistDir, "asset-manifest.json"),
  };
}
