import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";
import { minify } from "html-minifier-terser";
import { loadManifestForTarget, resolveBuildTarget } from "./manifest-utils.mjs";

const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const versionOverride = versionArg ? versionArg.slice("--version=".length) : null;
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg ? targetArg.slice("--target=".length) : "chrome";
const { outputZip } = resolveBuildTarget(target);
const root = "dist/correctly";

const manifest = loadManifestForTarget(target, versionOverride);
rmSync("dist", { recursive: true, force: true });
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const directory of ["background", "content", "popup", "lib", "providers", "services"]) {
  cpSync(directory, join(root, directory), { recursive: true });
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
  const tempZip = "cca-message-ai-temp.zip";
  rmSync(tempZip, { force: true });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path '${root}').Path, (Join-Path (Get-Location).Path '${tempZip}'))`,
  ]);
  renameSync(tempZip, outputZip);
} else {
  execFileSync("zip", ["-X", "-9", "-D", "-r", `../../${outputZip}`, "."], { cwd: root });
}
