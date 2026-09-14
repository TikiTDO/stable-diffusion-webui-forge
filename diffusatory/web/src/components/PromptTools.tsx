import { useMemo, useState } from "react";

import type { ForgeCatalog } from "../api/forge/types";

interface PromptToolsProps {
  catalog: ForgeCatalog;
  selectedStyles: string[];
  onStylesChange: (styles: string[]) => void;
  onInsert: (text: string) => void;
}

function matches(candidate: string, query: string): boolean {
  return !query || candidate.toLocaleLowerCase().includes(query);
}

export function PromptTools({
  catalog,
  selectedStyles,
  onStylesChange,
  onInsert,
}: PromptToolsProps) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const styles = useMemo(
    () => catalog.styles.filter((style) => matches(style.name, query)).slice(0, 18),
    [catalog.styles, query],
  );
  const loras = useMemo(
    () => catalog.loras.filter((lora) => matches(lora.name, query)).slice(0, 18),
    [catalog.loras, query],
  );
  const embeddings = useMemo(
    () => catalog.embeddings.filter((name) => matches(name, query)).slice(0, 18),
    [catalog.embeddings, query],
  );

  const toggleStyle = (name: string) => {
    onStylesChange(
      selectedStyles.includes(name)
        ? selectedStyles.filter((candidate) => candidate !== name)
        : [...selectedStyles, name],
    );
  };

  return (
    <details className="prompt-tools" open>
      <summary>
        <span>Prompt ingredients <kbd className="shortcut-chip" aria-hidden="true">Alt I</kbd></span>
        <small>
          {selectedStyles.length
            ? `${selectedStyles.length} style${selectedStyles.length === 1 ? "" : "s"}`
            : "Styles · LoRAs · embeddings"}
        </small>
      </summary>
      <div className="prompt-tools__body">
        <label className="library-search">
          <span>Find an ingredient</span>
          <input
            type="search"
            data-shortcut-target="ingredients"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this instance…"
          />
        </label>

        <div className="ingredient-columns">
          <section>
            <h3>Styles</h3>
            <div className="ingredient-list">
              {styles.map((style) => {
                const selected = selectedStyles.includes(style.name);
                return (
                  <button
                    type="button"
                    key={style.name}
                    className={selected ? "is-selected" : ""}
                    onClick={() => toggleStyle(style.name)}
                    title={[style.prompt, style.negative_prompt]
                      .filter(Boolean)
                      .join("\nNegative: ")}
                  >
                    {selected ? "✓ " : "+ "}
                    {style.name}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h3>LoRAs</h3>
            <div className="ingredient-list">
              {loras.map((lora) => (
                <button
                  type="button"
                  key={lora.name}
                  onClick={() => onInsert(`<lora:${lora.name}:1>`)}
                  title="Insert this LoRA at strength 1; edit the strength in the prompt"
                >
                  + {lora.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>Embeddings</h3>
            <div className="ingredient-list">
              {embeddings.map((name) => (
                <button type="button" key={name} onClick={() => onInsert(name)}>
                  + {name}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </details>
  );
}
