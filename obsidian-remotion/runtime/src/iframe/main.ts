/**
 * Iframe preview main entry point - Simplified React rendering
 * No Remotion, no Players, no complex state - just React components
 */

import type { IframeCommand } from "../shared/types";
import { BundleManager } from "./bundle";

// Shared DOM elements
const DOM = {
  loadingScreen: document.getElementById("loading-screen")!,
  errorScreen: document.getElementById("error-screen")!,
  errorTitle: document.getElementById("error-title")!,
  errorMessage: document.getElementById("error-message")!,
  debugPanel: document.getElementById("debug-content")!,
  componentsContainer: document.getElementById("components-container")!,
};

function sendMessage(msg: any): void {
  window.parent.postMessage(msg, "*");
}

function hideLoading(): void {
  DOM.loadingScreen.classList.add("hidden");
}

function showError(title: string, message: string): void {
  DOM.errorTitle.textContent = title;
  DOM.errorMessage.textContent = message;
  DOM.errorScreen.classList.remove("hidden");
  hideLoading();
}

function clearError(): void {
  DOM.errorScreen.classList.add("hidden");
}

function updateDebug(info: Record<string, any>): void {
  let html = "";
  for (const [key, value] of Object.entries(info)) {
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    html += `<div class="debug-item"><strong>${key}:</strong> <span class="debug-value">${escapeHtml(valueStr)}</span></div>`;
  }
  DOM.debugPanel.innerHTML = html;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

function renderComponents(components: any[]): void {
  DOM.componentsContainer.innerHTML = "";

  if (components.length === 0) {
    DOM.componentsContainer.innerHTML = '<div style="color: #666; padding: 20px;">No components to render</div>';
    return;
  }

  for (const comp of components) {
    const wrapper = document.createElement("div");
    wrapper.className = "component-item";
    wrapper.innerHTML = `
      <div class="component-title">Component: ${escapeHtml(comp.exportName)}</div>
      <div class="component-root" id="component-${escapeHtml(comp.exportName)}"></div>
    `;
    DOM.componentsContainer.appendChild(wrapper);
  }

  // Try to render components with React
  tryRenderComponents(components);
}

async function tryRenderComponents(components: any[]): Promise<void> {
  try {
    // Check if React is available
    const React = (window as any).React;
    const ReactDOM = (window as any).ReactDOM;

    if (!React || !ReactDOM) {
      updateDebug({
        "Status": "React not found in bundle",
        "React": !!React,
        "ReactDOM": !!ReactDOM,
      });
      return;
    }

    updateDebug({
      "Status": "Rendering components",
      "Component count": components.length,
    });

    for (const comp of components) {
      const container = document.getElementById(`component-${comp.exportName}`);
      if (!container) continue;

      try {
        // Create a wrapper to call the component as a function
        const element = React.createElement(comp.component);
        ReactDOM.createRoot(container).render(element);
      } catch (e) {
        container.innerHTML = `<div style="color: #f00;">Error rendering component: ${escapeHtml((e as any).message || String(e))}</div>`;
      }
    }
  } catch (e) {
    const msg = (e as any).message || String(e);
    updateDebug({
      "Status": "Error during render",
      "Error": msg,
    });
  }
}

// Bundle manager instance
const bundle = new BundleManager();

function handleBundle(code: string): void {
  try {
    const sequence = bundle.loadBundle(code, (message, stack) => {
      showError("Bundle Error", `${message}\n\n${stack}`);
      sendMessage({ type: "runtime-error", error: { message, stack } });
    });

    const components = (sequence?.scenes ?? []).map((scene) => ({
      exportName: scene.id,
      component: scene.component,
      options: scene.options,
    }));

    if (!components || components.length === 0) {
      clearError();
      renderComponents([]);
      updateDebug({
        "Status": "Bundle loaded",
        "Components": "0",
      });
    } else {
      clearError();
      renderComponents(components);
      updateDebug({
        "Status": "Bundle loaded",
        "Components": components.length.toString(),
        "Names": components.map((c: any) => c.exportName).join(", "),
      });
      sendMessage({ type: "bundle-ready", componentCount: components.length });
    }
  } catch (err) {
    const message = (err as any).message || String(err);
    const stack = (err as any).stack || "";
    showError("Bundle Execution Error", `${message}\n\n${stack}`);
    sendMessage({ type: "runtime-error", error: { message, stack } });
  }

  hideLoading();
}

// Message handler
function onMessage(event: MessageEvent): void {
  const cmd = event.data as IframeCommand;

  if (cmd.type === "bundle") {
    handleBundle(cmd.payload);
  }
}

// Set up message listener
window.addEventListener("message", onMessage);

// Initial state
updateDebug({
  "Status": "Ready",
  "Waiting for": "bundle",
});

sendMessage({ type: "runtime-ready" });
