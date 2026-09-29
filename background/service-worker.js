import { getStatus, improveText } from "../services/llama-client.js";

let rewriting = false;

async function performRewrite(text, mode) {
  if (rewriting) return { success: false, error: "Espera a que termine la mejora actual." };
  rewriting = true;
  try {
    const status = await getStatus();
    if (!status.connected) return { success: false, error: status.error };
    const result = await improveText(text, mode, status.model);
    return { success: true, text: result, model: status.model };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    rewriting = false;
  }
}

async function handleMessage(message, sender) {
  if (message?.type === "LLAMA_STATUS") return getStatus();

  if (message?.type === "REWRITE_MESSAGE") {
    const senderUrl = sender.url || sender.tab?.url;
    if (!sender.tab || !senderUrl?.startsWith("https://web.whatsapp.com/")) {
      return { success: false, error: "Esta acción solo está disponible en WhatsApp Web." };
    }
    if (typeof message.text !== "string" || !message.text.trim() || !["correct", "improve"].includes(message.mode)) {
      return { success: false, error: "Mensaje o acción no válidos." };
    }
    return performRewrite(message.text, message.mode);
  }

  if (message?.type === "TEST_LLAMA_MODEL" && !sender.tab) {
    return performRewrite("bunos dias", "correct");
  }

  return { success: false, error: "Acción desconocida." };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, (error) => {
    console.error("Local AI message handler:", error);
    sendResponse({ success: false, error: "No se pudo procesar el mensaje." });
  });
  return true;
});
