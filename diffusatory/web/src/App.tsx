import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type { InstanceDescriptor } from "./api/forge/types";
import { Composer } from "./components/Composer";
import { Stage } from "./components/Stage";
import {
  ImageEditor,
  type ImageEditorHandle,
} from "./features/editor/ImageEditor";
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
  const [workspaceMode, setWorkspaceMode] = useState<"compose" | "edit">(
    "compose",
  );
  const [editorSource, setEditorSource] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [editorDimensions, setEditorDimensions] = useState({
    width: 1024,
    height: 1024,
  });
  const [editorReady, setEditorReady] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editSettings, setEditSettings] = useState({
    denoisingStrength: 0.6,
    maskBlur: 4,
    inpaintOnlyMasked: true,
    inpaintPadding: 32,
  });
  const editorRef = useRef<ImageEditorHandle>(null);
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
    (workspaceMode === "edit" || Boolean(draft.prompt.trim())) &&
    !generating &&
    Boolean(
      instance?.capabilities.includes(
        workspaceMode === "compose" ? "txt2img" : "img2img",
      ),
    ) &&
    (workspaceMode === "compose" || editorReady) &&
    Boolean(catalog);
  const submit = async () => {
    if (!canGenerate) return;
    setEditorError(null);
    const request = requestFromDraft(draft);
    if (workspaceMode === "compose") {
      await generate({ kind: "txt2img", input: request });
      return;
    }
    const editor = editorRef.current?.exportForGeneration();
    if (!editor) {
      setEditorError("The visible editor source is not ready yet.");
      return;
    }
    await generate({
      kind: "img2img",
      input: {
        ...request,
        initImage: editor.initImage,
        mask: editor.mask ?? undefined,
        width: editor.width,
        height: editor.height,
        ...editSettings,
      },
    });
  };

  const openEditor = useCallback(
    (source: string | null) => {
      setEditorReady(false);
      setEditorError(null);
      setEditorSource(source);
      setEditorDimensions({ width: draft.width, height: draft.height });
      setEditorSession((current) => current + 1);
      setWorkspaceMode("edit");
    },
    [draft.height, draft.width],
  );
  const handleEditorReady = useCallback(() => setEditorReady(true), []);
  const changeWorkspaceMode = useCallback(
    (mode: "compose" | "edit") => {
      if (mode === "edit" && editorSession === 0) openEditor(null);
      else setWorkspaceMode(mode);
    },
    [editorSession, openEditor],
  );

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
          workspaceMode={workspaceMode}
          editSettings={editSettings}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onGenerate={() => void submit()}
          onInterrupt={() => void interrupt()}
          onSkip={() => void skip()}
          onReloadCatalog={() => {
            reload();
            void loadInstance();
          }}
          onWorkspaceModeChange={changeWorkspaceMode}
          onNewDrawing={() => openEditor(null)}
          onEditSettingsChange={(patch) =>
            setEditSettings((current) => ({ ...current, ...patch }))
          }
        />

        <div className="workspace-pane" hidden={workspaceMode !== "compose"}>
          <Stage generation={state} onRefine={openEditor} />
        </div>
        {editorSession > 0 && (
          <div className="workspace-pane" hidden={workspaceMode !== "edit"}>
          <section className="stage stage--editor" aria-label="Editing stage">
            <header className="stage__header">
              <div>
                <p className="eyebrow">Editor</p>
                <h2>{editorSource ? "Refine this shot" : "Draw the source"}</h2>
              </div>
              <button
                type="button"
                className="return-to-results"
                onClick={() => setWorkspaceMode("compose")}
              >
                Return to results
              </button>
            </header>
            {editorError && (
              <p className="stage__error" role="alert">{editorError}</p>
            )}
            <ImageEditor
              key={editorSession}
              ref={editorRef}
              source={editorSource}
              width={editorDimensions.width}
              height={editorDimensions.height}
              onReady={handleEditorReady}
            />
            {state.kind === "img2img" && state.images.length > 0 && (
              <div className="edit-results" aria-label="Edited candidates">
                <div>
                  <strong>Edited candidates</strong>
                  <small>Choose one to continue painting on it.</small>
                </div>
                <div className="edit-results__tray">
                  {state.images.map((image, index) => (
                    <button
                      type="button"
                      key={`${state.taskId}-edit-${index}`}
                      onClick={() => openEditor(image)}
                      aria-label={`Use edited candidate ${index + 1} as source`}
                    >
                      <img src={image} alt={`Edited candidate ${index + 1}`} />
                      <span>Use as source</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="return-to-results"
                  onClick={() => setWorkspaceMode("compose")}
                >
                  Compare full size
                </button>
              </div>
            )}
          </section>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>React client · existing Forge engine</span>
        <span>Gradio remains available during parity</span>
      </footer>
    </div>
  );
}
