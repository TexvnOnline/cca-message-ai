import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeStub } from "../helpers/chrome-stub.js";

let fetchMock;
let listener;

async function send(message, url = "https://web.whatsapp.com/", senderOverride = null) {
  return new Promise((resolve) => listener(message, senderOverride || { url, tab: { id: 1 } }, resolve));
}

beforeEach(async () => {
  vi.resetModules();
  const chromeStub = createChromeStub();
  vi.stubGlobal("chrome", chromeStub);
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith("/health")) return Response.json({ status: "ok" });
    if (url.endsWith("/v1/models")) return Response.json({ data: [{ id: "qwen2.5-3b-instruct.gguf" }] });
    return Response.json({ choices: [{ message: { content: "Buenos días." } }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  await import("../../background/service-worker.js");
  listener = chromeStub.runtime.onMessage.addListener.mock.calls[0][0];
});

afterEach(() => vi.unstubAllGlobals());

describe("local WhatsApp message flow", () => {
  it("detects the loaded GGUF and sends only the current draft with the system prompt", async () => {
    const status = await send({ type: "LLAMA_STATUS" });
    expect(status).toMatchObject({ connected: true, state: "ready", model: "qwen2.5-3b-instruct.gguf" });

    const result = await send({ type: "REWRITE_MESSAGE", mode: "improve", text: "bunos dias" });
    expect(result).toEqual({ success: true, text: "Buenos días.", model: "qwen2.5-3b-instruct.gguf" });
    const [url, options] = fetchMock.mock.calls.find(([url]) => url.endsWith("/v1/chat/completions"));
    expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("qwen2.5-3b-instruct.gguf");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "bunos dias" });
    expect(body).toMatchObject({ temperature: 0.2, max_tokens: 300, stream: false });
  });

  it("rejects requests outside WhatsApp and reports an unavailable server", async () => {
    expect(await send({ type: "REWRITE_MESSAGE", mode: "correct", text: "hola" }, "https://example.com/")).toMatchObject({
      success: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const status = await send({ type: "LLAMA_STATUS" });
    expect(status).toMatchObject({ connected: false, state: "unavailable", message: "IA local no disponible" });
  });

  it("distinguishes loading from an absent model", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Loading model" } }, { status: 503 }));
    expect(await send({ type: "LLAMA_STATUS" })).toMatchObject({ state: "loading", message: "Modelo cargando..." });

    fetchMock.mockImplementation(async (url) => url.endsWith("/health") ?
      Response.json({ status: "ok" }) : Response.json({ data: [] }));
    expect(await send({ type: "LLAMA_STATUS" })).toMatchObject({ state: "no-model", error: "No hay ningún modelo cargado." });
  });

  it("uses the smallest already loaded model when the server lists several", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      if (url.endsWith("/v1/models")) return Response.json({ data: [
        { id: "large", meta: { size: 8_000 }, status: { value: "loaded" } },
        { id: "small", meta: { size: 2_000 }, status: { value: "loaded" } },
        { id: "unloaded", meta: { size: 1_000 }, status: { value: "unloaded" } },
      ] });
      return Response.json({ choices: [{ message: { content: "Buenos días." } }] });
    });
    expect(await send({ type: "REWRITE_MESSAGE", mode: "correct", text: "bunos dias" })).toMatchObject({ model: "small" });
  });

  it("tests the model from the popup without a WhatsApp draft", async () => {
    const result = await send({ type: "TEST_LLAMA_MODEL" }, undefined, {
      url: "chrome-extension://test/popup/popup.html",
    });
    expect(result).toMatchObject({ success: true, text: "Buenos días." });
    const [, options] = fetchMock.mock.calls.find(([url]) => url.endsWith("/v1/chat/completions"));
    expect(JSON.parse(options.body).messages[1]).toEqual({ role: "user", content: "bunos dias" });
  });

  it("aborts a generation that exceeds 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const { improveText } = await import("../../services/llama-client.js");
      const pending = expect(improveText("hola", "improve", "qwen2.5-3b.gguf")).rejects.toThrow(
        "La IA local tardó demasiado en responder.",
      );
      await vi.advanceTimersByTimeAsync(30_001);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
