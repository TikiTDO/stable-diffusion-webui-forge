import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

async function start(): Promise<void> {
  // The cookie is HttpOnly by design. This explicit bootstrap also makes the
  // Vite development proxy behave like the production mount.
  try {
    await fetch("/diffusatory/api/v1/ui-session", {
      credentials: "same-origin",
    });
  } catch {
    // Render the workbench so its normal request errors can explain an
    // unavailable or API-only server instead of leaving a blank page.
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
