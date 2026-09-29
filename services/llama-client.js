import { MESSAGE_PROMPTS, REPAIR_PROMPTS } from "../lib/message-prompts.js";

export const LLAMA_SERVER = "http://127.0.0.1:8080";

const ERRORS = {
  unavailable: "No se encontró el servidor de IA local. Inicia llama-server e inténtalo nuevamente.",
  loading: "El modelo todavía está cargando.",
  timeout: "La IA local tardó demasiado en responder.",
  noModel: "No hay ningún modelo cargado.",
  failed: "No se pudo mejorar el mensaje con la IA local.",
  incomplete: "La IA local devolvió un mensaje incompleto. El borrador se conservó; inténtalo de nuevo o usa un texto más corto.",
  alteredFacts: "La IA local cambió cifras o datos de contacto del mensaje. El borrador se conservó.",
  notAnEdit: "La IA local respondió al mensaje en vez de editarlo. El borrador se conservó.",
};

async function request(path, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LLAMA_SERVER}${path}`, { ...options, signal: controller.signal });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      console.error(`llama-server ${path} JSON:`, error);
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error(`llama-server ${path}:`, error);
    throw new Error(controller.signal.aborted ? ERRORS.timeout : ERRORS.unavailable);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth() {
  const response = await request("/health", {}, 5_000);
  if (response.status === 503) throw new Error(ERRORS.loading);
  if (!response.ok) {
    console.error("llama-server /health:", response.status);
    throw new Error(ERRORS.unavailable);
  }
  if (response.data?.status !== "ok") throw new Error(ERRORS.loading);
  return true;
}

export async function getLoadedModel() {
  const response = await request("/v1/models", {}, 5_000);
  if (response.status === 503) throw new Error(ERRORS.loading);
  if (!response.ok) {
    console.error("llama-server /v1/models:", response.status);
    throw new Error(ERRORS.failed);
  }
  const models = Array.isArray(response.data?.data) ? response.data.data : [];
  const loaded = models.filter((item) => typeof item.id === "string" && item.id &&
    (!item.status || item.status.value === "loaded"));
  if (!loaded.length) {
    if (models.some((item) => item.status?.value === "loading")) throw new Error(ERRORS.loading);
    throw new Error(ERRORS.noModel);
  }
  // A regular llama-server reports one loaded model. If a router reports more,
  // use the smallest loaded model with size metadata instead of loading another.
  loaded.sort((a, b) => (a.meta?.size ?? Infinity) - (b.meta?.size ?? Infinity));
  return loaded[0].id;
}

export async function getStatus() {
  try {
    await checkHealth();
    const model = await getLoadedModel();
    return { connected: true, state: "ready", model, server: LLAMA_SERVER, message: "IA local lista" };
  } catch (error) {
    const state = error.message === ERRORS.loading ? "loading" :
      error.message === ERRORS.noModel ? "no-model" : "unavailable";
    return {
      connected: false,
      state,
      model: "",
      server: LLAMA_SERVER,
      message: state === "loading" ? "Modelo cargando..." :
        state === "no-model" ? ERRORS.noModel : "IA local no disponible",
      error: error.message,
    };
  }
}

function protectedFacts(text) {
  const pattern = /https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d+(?:[.,:/-]\d+)*/gi;
  return (text.match(pattern) || []).map((value) => value.replace(/[.,;!?)}\]]+$/, ""));
}

function cleanGeneratedText(content, original) {
  const cleaned = content.trim().replace(/^```(?:text)?\s*\n?/i, "").replace(/\n?```$/, "").trim();
  const originalIsQuoted = /^["“'«].*["”'»]$/s.test(original.trim());
  return originalIsQuoted ? cleaned : cleaned.replace(/^["“”'«](.*)["“”'»]$/s, "$1").trim();
}

function reviewGeneratedText(original, generated, mode) {
  if (JSON.stringify(protectedFacts(generated)) !== JSON.stringify(protectedFacts(original))) {
    return ERRORS.alteredFacts;
  }
  const maxLength = Math.max(
    original.length + (mode === "correct" ? 70 : 120),
    original.length * (mode === "correct" ? 1.7 : 2.2),
  );
  if (generated.length > maxLength) return ERRORS.notAnEdit;
  return null;
}

export async function improveText(text, mode = "improve", model = null) {
  if (!MESSAGE_PROMPTS[mode] || typeof text !== "string" || !text.trim()) {
    throw new Error("Mensaje o acción no válidos.");
  }
  const selectedModel = model || await getLoadedModel();
  const maxTokens = Math.min(1024, Math.max(384, Math.ceil(text.length * 0.5)));
  const generate = async (systemPrompt) => {
    const response = await request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        stream: false,
      }),
    }, 90_000);
    if (response.status === 503) throw new Error(ERRORS.loading);
    if (!response.ok) {
      console.error("llama-server /v1/chat/completions:", response.status);
      throw new Error(ERRORS.failed);
    }
    const choice = response.data?.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error(ERRORS.incomplete);
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      console.error("llama-server returned empty chat content");
      throw new Error(ERRORS.failed);
    }
    const cleaned = cleanGeneratedText(content, text);
    if (!cleaned) throw new Error(ERRORS.failed);
    return cleaned;
  };

  let generated = await generate(MESSAGE_PROMPTS[mode]);
  let issue = reviewGeneratedText(text, generated, mode);
  if (issue) {
    generated = await generate(REPAIR_PROMPTS[mode]);
    issue = reviewGeneratedText(text, generated, mode);
  }
  if (issue) throw new Error(issue);
  return generated;
}
