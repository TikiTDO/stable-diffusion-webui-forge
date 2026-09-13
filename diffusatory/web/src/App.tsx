import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type { InstanceDescriptor } from "./api/forge/types";
import { Composer } from "./components/Composer";
import { Stage } from "./components/Stage";
import {
  draftFromCatalog,
  requestFromDraft,
  starterDraft,
} from "./domain/draft";
import { useForgeCatalog } from "./domain/useForgeCatalog";
import { useForgeGeneration } from "./domain/useForgeGeneration";

export default function App() {
  const client = useMemo(() => new ForgeClient(), []);
  const [instance, setInstance] = useState<InstanceDescriptor | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [draft, setDraft] = useState(starterDraft);
  const catalogApplied = useRef(false);
  const { catalog, error: catalogError, loading: catalogLoading, reload } =
    useForgeCatalog(client);
  const { state, generate, interrupt, skip, generating } =
    useForgeGeneration(client);

  const loadInstance = useCallback(
    async (signal?: AbortSignal) => {
      setInstanceError(null);
      try {
        setInstance(await client.instance(signal));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setInstanceError(
          error instanceof Error ? error.message : "Instance unavailable",
        );
      }
    },
    [client],
  );

  useEffect(() => {
    const abort = new AbortController();
    void loadInstance(abort.signal);
    return () => abort.abort();
  }, [loadInstance]);

  useEffect(() => {
    if (!catalog || catalogApplied.current) return;
    catalogApplied.current = true;
    setDraft((current) => draftFromCatalog(current, catalog));
  }, [catalog]);

  const canGenerate =
    Boolean(draft.prompt.trim()) &&
    !generating &&
    Boolean(instance?.capabilities.includes("txt2img")) &&
    Boolean(catalog);
  const submit = () => {
    if (canGenerate) void generate(requestFromDraft(draft));
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
        <Composer
          draft={draft}
          catalog={catalog}
          catalogError={catalogError ?? instanceError}
          catalogLoading={catalogLoading}
          generating={generating}
          canGenerate={canGenerate}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onGenerate={submit}
          onInterrupt={() => void interrupt()}
          onSkip={() => void skip()}
          onReloadCatalog={() => {
            reload();
            void loadInstance();
          }}
        />

        <Stage generation={state} />
      </main>

      <footer className="footer">
        <span>React client · existing Forge engine</span>
        <span>Gradio remains available during parity</span>
      </footer>
    </div>
  );
}
