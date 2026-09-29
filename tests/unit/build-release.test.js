import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const TIMEOUT = 60_000;
const buildScript = "scripts/build-release.mjs";
const tempBuildBase = mkdtempSync(join(tmpdir(), "cca-build-test-"));

function runBuild(target) {
  const zip = join(tempBuildBase, target === "chrome" ? "chrome.zip" : "firefox.xpi");
  execFileSync("node", [buildScript, `--target=${target}`, `--output-base=${tempBuildBase}`, `--output-zip=${zip}`], {
    stdio: "pipe",
  });
}

afterAll(() => {
  const target = realpathSync(tempBuildBase);
  if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith("cca-build-test-")) {
    throw new Error("Refusing to clean a build directory outside the test temp folder");
  }
  rmSync(target, { recursive: true, force: true });
});

describe("build release", () => {
  it("builds chrome target", { timeout: TIMEOUT }, () => {
    runBuild("chrome");
    expect(existsSync(join(tempBuildBase, "cca-message-ai/manifest.json"))).toBe(true);
    expect(existsSync(join(tempBuildBase, "cca-message-ai/content/whatsapp-integration.js"))).toBe(true);
    expect(existsSync(join(tempBuildBase, "cca-message-ai/content/content.js"))).toBe(false);
    expect(existsSync(join(tempBuildBase, "cca-message-ai/providers"))).toBe(false);
  });

  it("builds firefox target", { timeout: TIMEOUT }, () => {
    runBuild("firefox");
    expect(existsSync(join(tempBuildBase, "cca-message-ai/manifest.json"))).toBe(true);
  });
});
