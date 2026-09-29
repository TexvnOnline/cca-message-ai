import { expect, test } from "@playwright/test";

test("WhatsApp composer actions replace the draft without sending", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent(`
    <style>
      #main { height: 600px; display: flex; flex-direction: column; }
      #conversation { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; }
      #main footer { height: 60px; flex: none; display: flex; align-items: center; }
      #editor, #editor-2 { width: 420px; min-height: 40px; }
    </style>
    <main id="main">
      <section id="conversation"><p>Último mensaje recibido</p></section>
      <footer><div id="editor" contenteditable="true" role="textbox"></div><button id="send" disabled>Enviar</button></footer>
    </main>
  `);
  await page.evaluate(() => {
    window.sent = 0;
    window.requests = [];
    const editor = document.querySelector("#editor");
    const send = document.querySelector("#send");
    editor.addEventListener("input", () => {
      send.disabled = !editor.innerText.trim();
    });
    send.addEventListener("click", () => {
      window.sent += 1;
    });
    window.chrome = {
      runtime: {
        sendMessage: async (request) => {
          window.requests.push(request);
          return {
            success: true,
            text: "Buenos días. ¿Me podría confirmar, por favor, si ya solucionaron el problema?",
          };
        },
      },
    };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  const editor = page.locator("#editor");
  await expect(page.locator("[data-cca-toolbar]")).toBeVisible();
  const conversationBox = await page.locator("#conversation").boundingBox();
  const toolbarBox = await page.locator("[data-cca-toolbar]").boundingBox();
  const footerBox = await page.locator("#main footer").boundingBox();
  expect(footerBox.y).toBeGreaterThanOrEqual(conversationBox.y + conversationBox.height);
  expect(toolbarBox.y).toBeGreaterThanOrEqual(footerBox.y);
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(footerBox.y + footerBox.height);
  await editor.fill("bunos dias me podria confirmar si ya solucionaron el problema porfavor");
  await page.getByRole("button", { name: "Mejorar" }).click();
  await expect(editor).toHaveText("Buenos días. ¿Me podría confirmar, por favor, si ya solucionaron el problema?");
  await expect(page.locator("#send")).toBeEnabled();
  expect(await page.evaluate(() => window.sent)).toBe(0);
  expect(await page.evaluate(() => window.requests)).toEqual([
    {
      type: "REWRITE_MESSAGE",
      mode: "improve",
      text: "bunos dias me podria confirmar si ya solucionaron el problema porfavor",
    },
  ]);

  await page.locator("#main footer").evaluate((footer) => {
    footer.outerHTML = '<footer><div id="editor-2" contenteditable="true" role="textbox"></div></footer>';
  });
  await expect(page.locator("[data-cca-toolbar]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Corregir" })).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test("a local AI error leaves the draft untouched", async ({ page }) => {
  await page.setContent(
    '<main id="main"><footer><div id="editor" contenteditable="true" role="textbox"></div></footer></main>',
  );
  await page.evaluate(() => {
    window.chrome = { runtime: { sendMessage: async () => ({ success: false, error: "IA local no disponible." }) } };
  });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#editor").fill("Mensaje original");
  await page.getByRole("button", { name: "Corregir" }).click();
  await expect(page.locator("#editor")).toHaveText("Mensaje original");
  await expect(page.locator("[data-cca-status]")).toContainText("IA local no disponible");
});

test("keeps actions beside a composer whose footer is positioned at the bottom", async ({ page }) => {
  await page.setContent(`
    <style>
      #main { position: relative; width: 800px; height: 500px; }
      #main footer { position: absolute; bottom: 0; display: flex; align-items: center; width: 100%; height: 60px; }
      #editor { flex: 1; min-height: 35px; }
    </style>
    <main id="main"><footer><div id="editor" contenteditable="true" role="textbox"></div></footer></main>
  `);
  await page.evaluate(() => {
    window.chrome = { runtime: { sendMessage: async () => ({ success: true, text: "Hola, ¿cómo estás?" }) } };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#editor").fill("hola como estas");
  await expect(page.locator("#main footer > [data-cca-toolbar]")).toBeVisible();
  const toolbarBox = await page.locator("[data-cca-toolbar]").boundingBox();
  const footerBox = await page.locator("#main footer").boundingBox();
  expect(toolbarBox.y).toBeGreaterThanOrEqual(footerBox.y);
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(footerBox.y + footerBox.height);
  await page.getByRole("button", { name: "Corregir" }).click();
  await expect(page.locator("#editor")).toHaveText("Hola, ¿cómo estás?");
});

test("editing the draft during generation prevents an overwrite", async ({ page }) => {
  await page.setContent(
    '<main id="main"><footer><div id="editor" contenteditable="true" role="textbox"></div></footer></main>',
  );
  await page.evaluate(() => {
    window.calls = 0;
    window.chrome = {
      runtime: {
        sendMessage: () => {
          window.calls += 1;
          return new Promise((resolve) => {
            window.finishRewrite = resolve;
          });
        },
      },
    };
  });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  const editor = page.locator("#editor");
  await editor.fill("Primer borrador");
  await page.getByRole("button", { name: "Mejorar" }).click();
  await expect(page.getByRole("button", { name: "Mejorar" })).toBeDisabled();
  await expect(page.locator("[data-cca-status]")).toContainText("Mejorando con IA local");
  await editor.fill("Borrador actualizado");
  await page.evaluate(() => window.finishRewrite({ success: true, text: "Respuesta tardía" }));
  await expect(editor).toHaveText("Borrador actualizado");
  await expect(page.locator("[data-cca-status]")).toContainText("No se reemplazó");
  expect(await page.evaluate(() => window.calls)).toBe(1);
});

test("retries insertion when the editor ignores execCommand", async ({ page }) => {
  await page.setContent(
    '<main id="main"><footer><div id="editor" contenteditable="true" role="textbox"></div></footer></main>',
  );
  await page.evaluate(() => {
    document.execCommand = () => true;
    window.chrome = {
      runtime: { sendMessage: async () => ({ success: true, text: "Buenos días." }) },
    };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#editor").fill("bunos dias");
  await page.getByRole("button", { name: "Corregir" }).click();
  await expect(page.locator("#editor")).toHaveText("Buenos días.");
  await expect(page.locator("[data-cca-status]")).toContainText("Listo");
});

test("improves an image caption instead of the chat composer", async ({ page }) => {
  await page.setContent(`
    <style>#main { width: 300px; } #media-preview { margin-left: 320px; }</style>
    <main id="main"><footer><div id="chat-editor" contenteditable="true" role="textbox">Borrador del chat</div></footer></main>
    <section id="media-preview">
      <div id="caption-wrap"><div id="caption" contenteditable="true" role="textbox"></div></div>
      <button id="send-image">Enviar imagen</button>
    </section>
  `);
  await page.evaluate(() => {
    window.sentImages = 0;
    window.requests = [];
    document.querySelector("#send-image").addEventListener("click", () => {
      window.sentImages += 1;
    });
    window.chrome = {
      runtime: {
        sendMessage: async (request) => {
          window.requests.push(request);
          return { success: true, text: "Crea una extensión de Chrome que mejore mis mensajes mientras escribo." };
        },
      },
    };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  const caption = page.locator("#caption");
  await caption.fill("cree una extencion que mejora mis mensajes mientras escribo");
  await expect(page.locator("body > [data-cca-toolbar].cca-toolbar--caption")).toBeVisible();
  await page.getByRole("button", { name: "Mejorar" }).click();
  await expect(caption).toHaveText("Crea una extensión de Chrome que mejore mis mensajes mientras escribo.");
  await expect(page.locator("#chat-editor")).toHaveText("Borrador del chat");
  await expect(page.locator("[data-cca-status]")).toContainText("Listo");
  expect(await page.evaluate(() => window.sentImages)).toBe(0);
  expect(await page.evaluate(() => window.requests)).toEqual([
    {
      type: "REWRITE_MESSAGE",
      mode: "improve",
      text: "cree una extencion que mejora mis mensajes mientras escribo",
    },
  ]);
});

test("corrects a media caption implemented as a textarea", async ({ page }) => {
  await page.setContent(`
    <main id="main"><footer><div id="chat-editor" contenteditable="true" role="textbox"></div></footer></main>
    <div id="caption-wrap"><textarea id="caption"></textarea></div>
  `);
  await page.evaluate(() => {
    window.chrome = { runtime: { sendMessage: async () => ({ success: true, text: "Buenos días." }) } };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#caption").fill("bunos dias");
  await expect(page.locator("body > [data-cca-toolbar].cca-toolbar--caption")).toBeVisible();
  await page.getByRole("button", { name: "Corregir" }).click();
  await expect(page.locator("#caption")).toHaveValue("Buenos días.");
  await expect(page.locator("#chat-editor")).toBeEmpty();
});

test("keeps actions outside the caption input in WhatsApp's media preview", async ({ page }) => {
  await page.setContent(`
    <style>
      #main { height: 800px; width: 900px; display: flex; flex-direction: column; }
      #preview { flex: 1; display: flex; flex-direction: column; }
      #image { flex: 1; }
      #preview footer { height: 60px; display: flex; align-items: center; }
      #caption-wrap { width: 70%; padding: 8px; border: 1px solid #ccc; }
      #caption { min-height: 30px; }
      #thumbnails { height: 100px; }
    </style>
    <main id="main"><section id="preview">
      <div id="image">Vista previa de imagen</div>
      <footer><div id="caption-wrap"><div id="caption" contenteditable="true" role="textbox"></div></div></footer>
      <div id="thumbnails"><button id="send-image">Enviar imagen</button></div>
    </section></main>
  `);
  await page.evaluate(() => {
    window.sentImages = 0;
    document.querySelector("#send-image").addEventListener("click", () => { window.sentImages += 1; });
    window.chrome = {
      runtime: { sendMessage: async () => ({ success: true, text: "Buenos días." }) },
    };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#caption").fill("bunos dias");

  const toolbar = page.locator("body > [data-cca-toolbar].cca-toolbar--caption");
  await expect(toolbar).toBeVisible();
  expect(await toolbar.evaluate((node) => Boolean(node.closest("footer, [contenteditable]")))).toBe(false);
  const toolbarBox = await toolbar.boundingBox();
  const inputBox = await page.locator("#caption-wrap").boundingBox();
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(inputBox.y);
  const stable = await page.evaluate(async () => {
    const toolbarNode = document.querySelector("[data-cca-toolbar]");
    for (let i = 0; i < 5; i++) document.querySelector("#image").append(document.createElement("span"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return toolbarNode.isConnected && toolbarNode === document.querySelector("[data-cca-toolbar]");
  });
  expect(stable).toBe(true);

  await page.getByRole("button", { name: "Mejorar" }).click();
  await expect(page.locator("#caption")).toHaveText("Buenos días.");
  expect(await page.evaluate(() => window.sentImages)).toBe(0);
});

test("does not place actions inside a nested media caption field", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.setContent(`
    <style>
      #main { height: 1000px; display: flex; flex-direction: column; }
      #image { flex: 1; }
      #caption-shell { margin-left: 900px; width: 680px; height: 52px; border-radius: 10px;
        background: #f0f2f5; display: flex; align-items: center; padding: 10px 24px; }
      #caption-inner, #caption { width: 100%; min-height: 28px; }
      #thumbnails { height: 110px; }
    </style>
    <main id="main"><div id="image">Vista previa</div>
      <div id="caption-shell"><div id="caption-inner"><div id="caption" contenteditable="true" role="textbox"></div></div></div>
      <div id="thumbnails"><button id="send-image">Enviar imagen</button></div>
    </main>
  `);
  await page.evaluate(() => {
    window.sentImages = 0;
    document.querySelector("#send-image").addEventListener("click", () => { window.sentImages += 1; });
    window.chrome = { runtime: { sendMessage: async () => ({ success: true, text: "Buenos días." }) } };
  });
  await page.addStyleTag({ path: "content/whatsapp-integration.css" });
  await page.addScriptTag({ path: "content/whatsapp-integration.js" });
  await page.locator("#caption").fill("bunos dias");

  const toolbar = page.locator("body > [data-cca-toolbar].cca-toolbar--caption");
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  const inputBox = await page.locator("#caption-shell").boundingBox();
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(inputBox.y);
  await page.getByRole("button", { name: "Mejorar" }).click();
  await expect(page.locator("#caption")).toHaveText("Buenos días.");
  expect(await page.evaluate(() => window.sentImages)).toBe(0);
});
