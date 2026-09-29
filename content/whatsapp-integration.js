(() => {
  let toolbar = null;
  let currentEditor = null;
  let lastEditedEditor = null;
  let busy = false;
  let scanScheduled = false;
  const editorSelector = '[contenteditable="true"], [contenteditable="plaintext-only"], textarea';

  function isChatEditor(editor, main) {
    if (editor.closest("[data-cca-toolbar]") || !editor.getClientRects().length) return false;
    const rect = editor.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (main?.contains(editor)) return true;
    const paneLeft = main?.getBoundingClientRect().left ?? window.innerWidth / 3;
    return rect.left >= paneLeft && rect.left < window.innerWidth;
  }

  function visibleEditors(main) {
    return Array.from(document.querySelectorAll(editorSelector)).filter((editor) => isChatEditor(editor, main));
  }

  function toolbarPlacement(editor, main) {
    const footer = editor.closest("footer");
    if (footer) {
      const footerRect = footer.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const mainBottom = main?.getBoundingClientRect().bottom ?? window.innerHeight;
      // A media preview has controls or thumbnails below its caption field.
      const isMediaCaption = mainBottom - footerRect.bottom > 72 || footerRect.bottom - editorRect.bottom > 72;
      if (!isMediaCaption) return { editor, anchor: footer, position: "prepend" };
    }
    return { editor, position: "floating" };
  }

  function findComposer() {
    const main = document.querySelector("#main") || document.querySelector('[role="main"]');
    const editors = visibleEditors(main);
    const focused = document.activeElement?.closest?.(editorSelector);
    let editor = editors.find((candidate) => candidate === focused);
    if (!editor && lastEditedEditor && editors.includes(lastEditedEditor) && readText(lastEditedEditor).trim()) {
      editor = lastEditedEditor;
    }
    if (!editor && currentEditor && editors.includes(currentEditor)) editor = currentEditor;
    if (editor) return toolbarPlacement(editor, main);

    const footerEditors = editors
      .filter((candidate) => candidate.closest("footer"))
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    const footerEditor = footerEditors.find((candidate) => candidate.getAttribute("role") === "textbox") || footerEditors[0];
    if (footerEditor) return toolbarPlacement(footerEditor, main);
    editor = editors.find((candidate) => candidate.getAttribute("role") === "textbox") || editors[0];
    if (editor) return toolbarPlacement(editor, main);
    return null;
  }

  function readText(editor) {
    if (editor instanceof HTMLTextAreaElement) return editor.value;
    return editor.innerText.replace(/\u00a0/g, " ");
  }

  function sameText(editor, text) {
    const normalize = (value) =>
      value
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .trimEnd();
    return normalize(readText(editor)) === normalize(text);
  }

  function selectEditorText(editor) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      editor.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function notifyInput(editor, text) {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  async function settleEditor() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function replaceText(editor, text) {
    if (editor instanceof HTMLTextAreaElement) {
      editor.focus();
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setValue.call(editor, text);
      notifyInput(editor, text);
      await settleEditor();
      if (!sameText(editor, text)) throw new Error("WhatsApp no aceptó el texto generado. El borrador se conservó.");
      editor.setSelectionRange(text.length, text.length);
      return;
    }
    selectEditorText(editor);
    let inputFired = false;
    const markInput = () => {
      inputFired = true;
    };
    editor.addEventListener("input", markInput);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      // The next insertion method may still work.
    }
    editor.removeEventListener("input", markInput);
    if (inserted && !inputFired) notifyInput(editor, text);
    await settleEditor();

    if (!sameText(editor, text)) {
      selectEditorText(editor);
      const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      let htmlInputFired = false;
      const markHtmlInput = () => {
        htmlInputFired = true;
      };
      editor.addEventListener("input", markHtmlInput);
      let htmlInserted = false;
      try {
        htmlInserted = document.execCommand("insertHTML", false, html);
      } catch {
        // A direct DOM update remains available below.
      }
      editor.removeEventListener("input", markHtmlInput);
      if (htmlInserted && !htmlInputFired) notifyInput(editor, text);
      await settleEditor();
    }

    if (!sameText(editor, text)) {
      editor.replaceChildren(document.createTextNode(text));
      notifyInput(editor, text);
      await settleEditor();
    }

    if (!sameText(editor, text)) throw new Error("WhatsApp no aceptó el texto generado. El borrador se conservó.");
    const selection = window.getSelection();
    const end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    selection.removeAllRanges();
    selection.addRange(end);
  }

  function setBusy(value, label = "", state = value ? "busy" : "idle") {
    busy = value;
    if (!toolbar) return;
    for (const button of toolbar.querySelectorAll("button")) button.disabled = value;
    toolbar.dataset.state = state;
    toolbar.querySelector("[data-cca-status]").textContent = label;
  }

  async function rewrite(mode) {
    if (busy) return;
    const composer = findComposer();
    if (!composer || composer.editor !== currentEditor) {
      setBusy(false, "No encuentro el cuadro de mensaje. Abre un chat e inténtalo de nuevo.", "error");
      return;
    }
    const { editor } = composer;
    const original = readText(editor);
    if (!original.trim()) {
      setBusy(false, "Escribe un mensaje primero.", "error");
      return;
    }

    const actionLabel = mode === "improve" ? "Mejorando" : "Corrigiendo";
    setBusy(true, `${actionLabel} con IA local…`);
    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      if (busy) setBusy(true, `${actionLabel} con IA local… ${Math.floor((Date.now() - startedAt) / 1000)} s`);
    }, 1000);
    let replacementAttempted = false;
    try {
      const result = await chrome.runtime.sendMessage({ type: "REWRITE_MESSAGE", mode, text: original });
      if (!result?.success) throw new Error(result?.error || "No se pudo procesar el mensaje.");
      if (!editor.isConnected || findComposer()?.editor !== editor || !sameText(editor, original)) {
        throw new Error("El mensaje cambió mientras respondía la IA local. No se reemplazó.");
      }
      replacementAttempted = true;
      await replaceText(editor, result.text);
      setBusy(false, "Listo. Revisa el mensaje antes de enviarlo.", "success");
    } catch (error) {
      if (replacementAttempted && editor.isConnected) {
        try {
          await replaceText(editor, original);
        } catch {
          // A failed restore must not hide the original error.
        }
      }
      setBusy(false, error.message || "No se pudo procesar el mensaje.", "error");
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  function createToolbar() {
    const root = document.createElement("div");
    root.className = "cca-toolbar";
    root.dataset.ccaToolbar = "";
    root.dataset.state = "idle";
    const buttonRow = document.createElement("div");
    buttonRow.className = "cca-actions";
    const actions = [
      ["correct", "✓ Corregir"],
      ["improve", "✨ Mejorar"],
    ];
    for (const [mode, label] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => rewrite(mode));
      buttonRow.append(button);
    }
    root.append(buttonRow);
    const status = document.createElement("span");
    status.dataset.ccaStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(status);
    return root;
  }

  function positionFloatingToolbar(editor) {
    if (!toolbar || !editor?.isConnected) return;
    const rect = editor.getBoundingClientRect();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const topAbove = rect.top - height - 24;
    const top = topAbove >= 8 ? topAbove : Math.min(rect.bottom + 8, window.innerHeight - height - 8);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    toolbar.style.top = `${Math.max(8, top)}px`;
    toolbar.style.left = `${left}px`;
  }

  function syncComposer() {
    scanScheduled = false;
    const composer = findComposer();
    if (composer?.editor === currentEditor && toolbar?.isConnected) {
      if (composer.position === "floating") positionFloatingToolbar(currentEditor);
      return;
    }
    toolbar?.remove();
    toolbar = null;
    currentEditor = composer?.editor || null;
    if (!currentEditor) return;
    toolbar = createToolbar();
    if (composer.position === "prepend") {
      toolbar.classList.add("cca-toolbar--composer");
      composer.anchor.prepend(toolbar);
    } else {
      toolbar.classList.add("cca-toolbar--caption");
      document.body.append(toolbar);
      positionFloatingToolbar(currentEditor);
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(syncComposer);
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(
    "input",
    (event) => {
      const edited = event.target.closest?.(editorSelector);
      const main = document.querySelector("#main") || document.querySelector('[role="main"]');
      if (edited && isChatEditor(edited, main)) {
        lastEditedEditor = edited;
      }
      scheduleScan();
    },
    true,
  );
  document.addEventListener("focusin", scheduleScan, true);
  window.addEventListener("resize", scheduleScan);
  window.addEventListener("scroll", scheduleScan, true);
  scheduleScan();
})();
