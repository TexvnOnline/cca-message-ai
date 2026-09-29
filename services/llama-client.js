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
  notAnEdit: "La IA local se apartó del texto original. El borrador se conservó.",
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

function contentWords(text) {
  const anchors = new Set(["no", "ya", "sin", "nunca"]);
  const words = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) || [];
  const meaningful = words.filter((word) => word.length >= 4 || anchors.has(word));
  return meaningful.length > 0 ? meaningful : words;
}

function isNearbyWord(source, candidate) {
  if (source === candidate) return true;
  if (Math.abs(source.length - candidate.length) > 1) return false;
  let edits = 0;
  let i = 0;
  let j = 0;
  while (i < source.length && j < candidate.length) {
    if (source[i] === candidate[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (source.length >= candidate.length) i++;
    if (candidate.length >= source.length) j++;
  }
  return edits + (source.length - i) + (candidate.length - j) <= 1;
}

function preservesSourceWords(original, generated) {
  const source = contentWords(original);
  const candidate = contentWords(generated);
  if (source.length === 0) return generated.trim() === original.trim();
  if (source.length > 80) return true;
  const remaining = [...candidate];
  let matched = 0;
  for (const word of source) {
    const index = remaining.findIndex((other) => isNearbyWord(word, other));
    if (index < 0) continue;
    matched++;
    remaining.splice(index, 1);
  }
  const anchors = ["no", "ya", "sin", "nunca"];
  if (anchors.some((word) => source.filter((item) => item === word).length !== candidate.filter((item) => item === word).length)) {
    return false;
  }
  return matched / source.length >= 0.75 && remaining.length <= Math.max(1, Math.ceil(source.length * 0.4));
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
  if (!preservesSourceWords(original, generated)) return ERRORS.notAnEdit;
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
