const statusLabel = document.querySelector("#local-ai-status");
const statusDetail = document.querySelector("#status-detail");
const modelName = document.querySelector("#model-name");
const refreshButton = document.querySelector("#check-connection");
const testButton = document.querySelector("#test-model");
const testResult = document.querySelector("#test-result");

async function refreshStatus() {
  refreshButton.disabled = true;
  statusLabel.textContent = "Comprobando...";
  statusDetail.textContent = "";
  try {
    const status = await chrome.runtime.sendMessage({ type: "LLAMA_STATUS" });
    statusLabel.textContent = status.state === "ready" ? "Conectado" :
      status.state === "loading" ? "Modelo cargando..." : "Desconectado";
    statusDetail.textContent = status.message;
    modelName.value = status.model || "Ninguno";
    testButton.disabled = !status.connected;
  } catch (error) {
    console.error("Local AI status:", error);
    statusLabel.textContent = "Desconectado";
    statusDetail.textContent = "IA local no disponible";
    modelName.value = "Ninguno";
    testButton.disabled = true;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshStatus);
testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  testResult.textContent = "Probando el modelo...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_LLAMA_MODEL" });
    if (!result?.success) throw new Error(result?.error || "No se pudo probar el modelo.");
    testResult.textContent = `Respuesta: ${result.text}`;
  } catch (error) {
    testResult.textContent = error.message || "No se pudo probar el modelo.";
  } finally {
    await refreshStatus();
  }
});

refreshStatus();
