import { useEffect, useMemo, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type { InstanceDescriptor } from "./api/forge/types";
import { Stage } from "./components/Stage";
import { useForgeGeneration } from "./domain/useForgeGeneration";

const STARTER_PROMPT = "an observatory at blue hour, warm lamps, patient instruments";

export default function App() {
  const client = useMemo(() => new ForgeClient(), []);
  const [instance, setInstance] = useState<InstanceDescriptor | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(STARTER_PROMPT);
  const { state, generate, interrupt, generating } =
    useForgeGeneration(client);

  useEffect(() => {
    const abort = new AbortController();
    client
      .instance(abort.signal)
      .then(setInstance)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setInstanceError(
          error instanceof Error ? error.message : "Instance unavailable",
        );
      });
    return () => abort.abort();
  }, [client]);

  const canGenerate =
    Boolean(prompt.trim()) &&
    !generating &&
    Boolean(instance?.capabilities.includes("txt2img"));
  const submit = () => {
    if (canGenerate) void generate({ prompt: prompt.trim() });
  };

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <p className="eyebrow">Visual story workbench</p>
            <h1>Diffusatory</h1>
          </div>
        </div>
        <div className="instance">
          <span
            className={`instance__light ${instance ? "is-ready" : ""}`}
            aria-hidden="true"
          />
          <div>
            <strong>{instance?.name ?? "Finding the local instrument…"}</strong>
            <small>
              {instance
                ? `${instance.host} · ${instance.version.slice(0, 8)}`
                : instanceError ?? "Reading capabilities"}
            </small>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="composer" aria-label="Composer">
          <div className="composer__heading">
            <div>
              <p className="eyebrow">Composer</p>
              <h2>What should exist?</h2>
            </div>
            <span className="draft-label">SDXL draft</span>
          </div>

          <label className="prompt-field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={10}
              spellCheck="true"
              autoFocus
            />
          </label>

          <p className="composer__note">
            This first seam deliberately uses Forge’s existing defaults: Euler a,
            Karras, 20 steps, CFG 5, 1024 square. Controls arrive after the path
            itself is proven.
          </p>

          {instanceError && (
            <p className="connection-error" role="alert">
              The Diffusatory instance descriptor is not available yet: {instanceError}
            </p>
          )}

          <div className="composer__actions">
            <button
              className="generate"
              type="button"
              disabled={!canGenerate}
              onClick={submit}
            >
              <span>{generating ? "Forge is working" : "Generate image"}</span>
              <kbd>⌘/Ctrl ↵</kbd>
            </button>
            <button
              className="interrupt"
              type="button"
              disabled={!generating}
              onClick={interrupt}
            >
              Interrupt active render
            </button>
          </div>

          <div className="capabilities">
            <span>Current instrument</span>
            <div>
              {(instance?.capabilities ?? []).slice(0, 6).map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </div>
        </section>

        <Stage generation={state} />
      </main>

      <footer className="footer">
        <span>React client · existing Forge engine</span>
        <span>Gradio remains available during parity</span>
      </footer>
    </div>
  );
}
