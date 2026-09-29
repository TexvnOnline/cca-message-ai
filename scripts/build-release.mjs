import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { transform } from "esbuild";
import { minify } from "html-minifier-terser";
import { loadManifestForTarget, resolveBuildTarget } from "./manifest-utils.mjs";

const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const versionOverride = versionArg ? versionArg.slice("--version=".length) : null;
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg ? targetArg.slice("--target=".length) : "chrome";
const outputBaseArg = process.argv.find((arg) => arg.startsWith("--output-base="));
const outputZipArg = process.argv.find((arg) => arg.startsWith("--output-zip="));
const outputBase = resolve(outputBaseArg ? outputBaseArg.slice("--output-base=".length) : "dist");
const root = join(outputBase, "cca-message-ai");
const { outputZip: defaultZip } = resolveBuildTarget(target);
const outputZip = resolve(outputZipArg ? outputZipArg.slice("--output-zip=".length) : defaultZip);

const manifest = loadManifestForTarget(target, versionOverride);
// Other folders under dist may be installed in Chrome. Only replace this build's folder.
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
mkdirSync(dirname(outputZip), { recursive: true });
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of [
  "background/service-worker.js",
  "content/whatsapp-integration.js",
  "content/whatsapp-integration.css",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "lib/message-prompts.js",
  "services/llama-client.js",
]) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  cpSync(file, join(root, file));
}
mkdirSync(join(root, "icons"), { recursive: true });
for (const size of [16, 48, 128]) cpSync(`icons/icon${size}.png`, join(root, `icons/icon${size}.png`));

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

for (const path of files(root)) {
  if (path.endsWith(".js") || path.endsWith(".css")) {
    const loader = path.endsWith(".js") ? "js" : "css";
    const result = await transform(readFileSync(path, "utf8"), { loader, minify: true, legalComments: "none" });
    writeFileSync(path, result.code);
  } else if (path.endsWith(".html")) {
    const result = await minify(readFileSync(path, "utf8"), {
      collapseWhitespace: true,
      removeComments: true,
      removeOptionalTags: true,
      removeAttributeQuotes: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      minifyCSS: true,
      minifyJS: false,
    });
    writeFileSync(path, result);
  }
}

for (const path of files(root)) if (path.endsWith(".js")) execFileSync("node", ["--check", path]);

rmSync(outputZip, { force: true });
if (process.platform === "win32") {
  const tempZip = join(dirname(outputZip), "cca-message-ai-temp.zip");
  rmSync(tempZip, { force: true });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path '${root}').Path, '${tempZip}')`,
  ]);
  renameSync(tempZip, outputZip);
} else {
  execFileSync("zip", ["-X", "-9", "-D", "-r", outputZip, "."], { cwd: root });
}
