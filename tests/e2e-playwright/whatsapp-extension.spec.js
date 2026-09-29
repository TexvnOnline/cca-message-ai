import http from "node:http";
import { expect, test } from "@playwright/test";
import { cleanupContext, launchExtensionContext } from "./helpers.js";

test("Chrome loads the extension and shows the local server status", async () => {
  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    const pageErrors = [];
    popup.on("pageerror", (error) => pageErrors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popup.locator("#local-ai-status")).not.toHaveText("Comprobando...");
    await expect(popup.locator("#server")).toHaveValue("http://127.0.0.1:8080");
    expect(pageErrors).toEqual([]);
  } finally {
    await cleanupContext(context, userDataDir);
  }
});

test("the extension detects a local server, rewrites the draft, and does not send it", async () => {
  const requests = [];
  const mock = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") return res.end(JSON.stringify({ status: "ok" }));
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "qwen2.5-3b.gguf" }] }));
    if (req.url === "/v1/chat/completions") {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      return res.end(JSON.stringify({ choices: [{ message: { content: "Buenos días." } }] }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  const listening = await new Promise((resolve) => {
    mock.once("error", () => resolve(false));
    mock.listen(8080, "127.0.0.1", () => resolve(true));
  });
  test.skip(!listening, "Port 8080 is already occupied");

  let context;
  let userDataDir;
  try {
    const launched = await launchExtensionContext();
    ({ context, userDataDir } = launched);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${launched.extensionId}/popup/popup.html`);
    await expect(popup.locator("#local-ai-status")).toHaveText("Conectado");
    await expect(popup.locator("#model-name")).toHaveValue("qwen2.5-3b.gguf");

    const page = await context.newPage();
    await page.route("https://web.whatsapp.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<main id="main"><footer><div id="draft" contenteditable="true" role="textbox"></div><button id="send" onclick="window.sent=(window.sent||0)+1">Enviar</button></footer></main>',
    }));
    await page.goto("https://web.whatsapp.com/");
    await page.locator("#draft").fill("bunos dias");
    await page.getByRole("button", { name: "Mejorar" }).click();
    await expect(page.locator("#draft")).toHaveText("Buenos días.");
    expect(await page.evaluate(() => window.sent || 0)).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("qwen2.5-3b.gguf");
    expect(requests[0].messages[1]).toEqual({ role: "user", content: "bunos dias" });
  } finally {
    if (context) await cleanupContext(context, userDataDir);
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("the extension uses local llama-server and leaves the WhatsApp draft unsent", async () => {
  test.skip(
    process.env.CCA_LIVE_EXTENSION !== "1",
    "Requires a Chrome session that allows loading unpacked extensions",
  );
  const available = await fetch("http://127.0.0.1:8080/health")
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!available, "llama-server is not running on this machine");
  test.setTimeout(180000);
  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popup.locator("#local-ai-status")).toHaveText("Conectado");
    await expect(popup.locator("#model-name")).not.toHaveValue("Ninguno");

    const page = await context.newPage();
    await page.route("https://web.whatsapp.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><main id="main"><footer>
          <div id="draft" contenteditable="true" role="textbox"></div>
          <button id="send" onclick="window.sent=(window.sent||0)+1">Enviar</button>
        </footer></main></body></html>`,
      }),
    );
    await page.goto("https://web.whatsapp.com/");
    await page.locator("#draft").fill("bunos dias me podria confirmar si ya solucionaron el problema porfavor");
    await page.getByRole("button", { name: "Mejorar" }).click();
    await expect(page.locator("#draft")).not.toHaveText(
      "bunos dias me podria confirmar si ya solucionaron el problema porfavor",
      {
        timeout: 150000,
      },
    );
    await expect(page.locator("#draft")).toContainText("Buenos días");
    expect(await page.evaluate(() => window.sent || 0)).toBe(0);

    await page.evaluate(() => {
      const main = document.querySelector("#main");
      main.style.cssText = "height: 800px; display: flex; flex-direction: column";
      main.innerHTML = `<section id="preview" style="flex:1;display:flex;flex-direction:column">
        <div style="flex:1">Vista previa</div>
        <footer style="height:60px"><div id="caption" contenteditable="true" role="textbox"></div></footer>
        <div style="height:100px"><button id="send-image">Enviar imagen</button></div>
      </section>`;
      window.sentImages = 0;
      document.querySelector("#send-image").addEventListener("click", () => { window.sentImages += 1; });
    });
    await page.locator("#caption").fill("bunos dias");
    await expect(page.locator("body > [data-cca-toolbar].cca-toolbar--caption")).toBeVisible();
    await page.getByRole("button", { name: "Mejorar" }).click();
    await expect(page.locator("#caption")).not.toHaveText("bunos dias");
    expect(await page.evaluate(() => window.sentImages)).toBe(0);

    await page.evaluate(() => {
      document.querySelector("#main").innerHTML = `<div style="flex:1">Vista previa</div>
        <div id="caption-shell" style="height:52px;background:#f0f2f5;padding:10px 24px">
          <div><div id="nested-caption" contenteditable="true" role="textbox"></div></div>
        </div><div style="height:100px"><button id="send-image-2">Enviar imagen</button></div>`;
      document.querySelector("#send-image-2").addEventListener("click", () => { window.sentImages += 1; });
    });
    await page.locator("#nested-caption").fill("bunos dias");
    const nestedToolbar = page.locator("body > [data-cca-toolbar].cca-toolbar--caption");
    await expect(nestedToolbar).toBeVisible();
    const toolbarBox = await nestedToolbar.boundingBox();
    const inputBox = await page.locator("#caption-shell").boundingBox();
    expect(toolbarBox.y + toolbarBox.height).toBeLessThan(inputBox.y);
    await page.getByRole("button", { name: "Mejorar" }).click();
    await expect(page.locator("#nested-caption")).not.toHaveText("bunos dias");
    expect(await page.evaluate(() => window.sentImages)).toBe(0);
  } finally {
    await cleanupContext(context, userDataDir);
  }
});
