import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

const TIMEOUT = 60_000;
const buildScript = "scripts/build-release.mjs";
const artifacts = ["cca-message-ai-firefox.xpi"];

afterAll(() => {
  rmSync("dist", { recursive: true, force: true });
  for (const f of artifacts) {
    if (existsSync(f)) rmSync(f);
  }
});

describe("build release", () => {
  it("builds chrome target", { timeout: TIMEOUT }, () => {
    execFileSync("node", [buildScript, "--target=chrome"], { stdio: "pipe" });
    expect(existsSync("dist/cca-message-ai/manifest.json")).toBe(true);
    expect(existsSync("dist/cca-message-ai/content/whatsapp-integration.js")).toBe(true);
    expect(existsSync("dist/cca-message-ai/content/content.js")).toBe(false);
    expect(existsSync("dist/cca-message-ai/providers")).toBe(false);
  });

  it("builds firefox target", { timeout: TIMEOUT }, () => {
    execFileSync("node", [buildScript, "--target=firefox"], { stdio: "pipe" });
    expect(existsSync("dist/cca-message-ai/manifest.json")).toBe(true);
  });
});
