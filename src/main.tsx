import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

function showCenteredError(message: string, detail?: string) {
  const existing = document.getElementById("kimix-runtime-error");
  if (existing) existing.remove();
  const container = document.createElement("div");
  container.id = "kimix-runtime-error";
  container.setAttribute("role", "alertdialog");
  container.setAttribute("aria-modal", "true");
  container.innerHTML = `
    <div class="kimix-runtime-error-card">
      <button class="kimix-runtime-error-close" type="button" aria-label="关闭错误提示">×</button>
      <div class="kimix-runtime-error-heading">
        <div class="kimix-runtime-error-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 8v5" />
            <path d="M12 17h.01" />
            <path d="M10.3 4.6 2.7 18a1.8 1.8 0 0 0 1.6 2.7h15.4a1.8 1.8 0 0 0 1.6-2.7L13.7 4.6a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <div class="kimix-runtime-error-title">界面遇到错误</div>
      </div>
      <div class="kimix-runtime-error-message"></div>
      <div class="kimix-runtime-error-detail"></div>
      <button class="kimix-runtime-error-button" type="button">重新载入</button>
    </div>
  `;
  container.querySelector(".kimix-runtime-error-message")!.textContent = message;
  container.querySelector(".kimix-runtime-error-detail")!.textContent = detail ?? "";
  container.querySelector(".kimix-runtime-error-close")?.addEventListener("click", () => container.remove());
  container.querySelector(".kimix-runtime-error-button")?.addEventListener("click", () => window.location.reload());
  document.body.appendChild(container);
}

window.addEventListener("error", (event) => {
  showCenteredError(event.message, `${event.filename}:${event.lineno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  showCenteredError(reason);
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
