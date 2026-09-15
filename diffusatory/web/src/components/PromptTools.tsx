import { useMemo, useState } from "react";

import type { ForgeCatalog, Lora } from "../api/forge/types";
import {
  activeLoraFromCatalog,
  loraSearchMatch,
  restoreLoraDefaults,
  visibleLoraKeywordIndexes,
  type ActiveLora,
  type LoraSearchGroup,
  type LoraSearchMatch,
} from "../domain/loras";

interface PromptToolsProps {
  catalog: ForgeCatalog;
  selectedStyles: string[];
  activeLoras: ActiveLora[];
  onStylesChange: (styles: string[]) => void;
  onLorasChange: (loras: ActiveLora[]) => void;
  onInsert: (text: string) => void;
  onSaveDefaults: (lora: Lora, active: ActiveLora) => Promise<void>;
  onRefreshLibrary: () => Promise<number>;
}

function matches(candidate: string, query: string): boolean {
  return !query || candidate.toLocaleLowerCase().includes(query);
}

function loraTitle(lora: Lora): string {
  return (
    lora.name ||
    lora.relative_path.split("/").at(-1)?.replace(/\.safetensors$/i, "") ||
    "LoRA"
  );
}

interface SearchResult {
  lora: Lora;
  match: LoraSearchMatch | null;
  score: number;
}

interface SearchResultGroup {
  key: LoraSearchGroup | "all" | "random";
  label: string;
  total: number;
  results: SearchResult[];
}

const SEARCH_GROUPS: Array<{ key: LoraSearchGroup; label: string }> = [
  { key: "identity", label: "Names & files" },
  { key: "tags", label: "Tags" },
  { key: "activation", label: "Activation terms" },
  { key: "details", label: "Descriptions & notes" },
];

function HighlightedText({
  value,
  indexes,
}: {
  value: string;
  indexes: number[];
}) {
  const selected = new Set(indexes);
  const runs: Array<{ text: string; selected: boolean }> = [];
  for (const [index, character] of Array.from(value).entries()) {
    const highlighted = selected.has(index);
    const previous = runs.at(-1);
    if (previous?.selected === highlighted) previous.text += character;
    else runs.push({ text: character, selected: highlighted });
  }
  return (
    <>
      {runs.map((run, index) =>
        run.selected ? (
          <mark key={index}>{run.text}</mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

export function PromptTools({
  catalog,
  selectedStyles,
  activeLoras,
  onStylesChange,
  onLorasChange,
  onInsert,
  onSaveDefaults,
  onRefreshLibrary,
}: PromptToolsProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [secondarySearch, setSecondarySearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [randomOrder, setRandomOrder] = useState<string[]>([]);
  const [expandedKeywordIds, setExpandedKeywordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const query = search.trim();
  const secondaryQuery = secondarySearch.trim().toLocaleLowerCase();
  const activeIds = useMemo(
    () => new Set(activeLoras.map((lora) => lora.id)),
    [activeLoras],
  );
  const catalogById = useMemo(
    () => new Map(catalog.loras.map((lora) => [lora.id, lora])),
    [catalog.loras],
  );

  const loraGroups = useMemo<SearchResultGroup[]>(() => {
    const randomRank = new Map(randomOrder.map((id, index) => [id, index]));
    if (!query) {
      const results = catalog.loras.map((lora) => ({
        lora,
        match: null,
        score: 0,
      }));
      results.sort((left, right) =>
        randomOrder.length
          ? (randomRank.get(left.lora.id) ?? Number.MAX_SAFE_INTEGER) -
            (randomRank.get(right.lora.id) ?? Number.MAX_SAFE_INTEGER)
          : left.lora.name.localeCompare(right.lora.name),
      );
      return [{
        key: randomOrder.length ? "random" : "all",
        label: randomOrder.length ? "Random selection" : "All LoRAs",
        total: catalog.loras.length,
        results: results.slice(0, 48),
      }];
    }

    const matches = catalog.loras.flatMap((lora) => {
      const match = loraSearchMatch(lora, query);
      return match ? [{ lora, match, score: match.score }] : [];
    });
    return SEARCH_GROUPS.flatMap(({ key, label }) => {
      const results = matches
        .filter((result) => result.match.group === key)
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.lora.name.localeCompare(right.lora.name),
        );
      return results.length
        ? [{ key, label, total: results.length, results: results.slice(0, 24) }]
        : [];
    });
  }, [catalog.loras, query, randomOrder]);

  const styles = useMemo(
    () =>
      catalog.styles
        .filter((style) => matches(style.name, secondaryQuery))
        .slice(0, 18),
    [catalog.styles, secondaryQuery],
  );
  const embeddings = useMemo(
    () =>
      catalog.embeddings
        .filter((name) => matches(name, secondaryQuery))
        .slice(0, 30),
    [catalog.embeddings, secondaryQuery],
  );

  const changeActive = (
    id: string,
    transform: (lora: ActiveLora) => ActiveLora,
  ) => {
    onLorasChange(
      activeLoras.map((lora) => (lora.id === id ? transform(lora) : lora)),
    );
  };

  const toggleStyle = (name: string) => {
    onStylesChange(
      selectedStyles.includes(name)
        ? selectedStyles.filter((candidate) => candidate !== name)
        : [...selectedStyles, name],
    );
  };

  const shuffle = () => {
    const ids = catalog.loras.map((lora) => lora.id);
    for (let index = ids.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [ids[index], ids[swap]] = [ids[swap], ids[index]];
    }
    setSearch("");
    setRandomOrder(ids);
  };

  const refreshLibrary = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshStatus(null);
    try {
      const count = await onRefreshLibrary();
      setRandomOrder([]);
      setRefreshStatus(`Library refreshed · ${count} LoRAs found`);
    } catch (error) {
      setRefreshStatus(
        error instanceof Error ? error.message : "LoRA refresh failed.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const saveDefaults = async (active: ActiveLora) => {
    const source = catalogById.get(active.id);
    if (!source || savingId) return;
    setSavingId(active.id);
    setSaveError(null);
    try {
      await onSaveDefaults(source, active);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Defaults could not be saved.",
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="prompt-tools" aria-label="LoRA prompt workbench">
      <header className="lora-shelf__header">
        <div>
          <strong>
            LoRAs <kbd className="shortcut-chip" aria-hidden="true">Alt I</kbd>
          </strong>
          <small>
            {activeLoras.filter((lora) => lora.enabled).length} active ·{" "}
            {activeLoras.length} pinned
          </small>
        </div>
        <button type="button" onClick={() => setLibraryOpen((open) => !open)}>
          {libraryOpen ? "Close library" : "LoRA library"}
        </button>
      </header>

      {activeLoras.length ? (
        <div className="lora-shelf">
          {activeLoras.map((active) => {
            const source = catalogById.get(active.id);
            const keywordsExpanded = expandedKeywordIds.has(active.id);
            const visibleKeywordIndexes = visibleLoraKeywordIndexes(
              active.keywords,
              keywordsExpanded,
            );
            const hiddenKeywordCount =
              active.keywords.length - visibleKeywordIndexes.length;
            return (
              <article
                className={`active-lora ${active.enabled ? "" : "is-disabled"}`}
                key={active.id}
              >
                <header>
                  <button
                    type="button"
                    className="active-lora__toggle"
                    aria-pressed={active.enabled}
                    onClick={() =>
                      changeActive(active.id, (lora) => ({
                        ...lora,
                        enabled: !lora.enabled,
                      }))
                    }
                    title={active.enabled ? "Disable this LoRA" : "Enable this LoRA"}
                  >
                    {active.enabled ? "On" : "Off"}
                  </button>
                  <strong>{source ? loraTitle(source) : active.name}</strong>
                  <label>
                    <span>Strength</span>
                    <input
                      type="number"
                      min="-10"
                      max="10"
                      step="0.05"
                      value={active.strength}
                      onChange={(event) =>
                        changeActive(active.id, (lora) => ({
                          ...lora,
                          strength: Number.isFinite(event.target.valueAsNumber)
                            ? event.target.valueAsNumber
                            : lora.strength,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="active-lora__remove"
                    onClick={() =>
                      onLorasChange(
                        activeLoras.filter((lora) => lora.id !== active.id),
                      )
                    }
                    aria-label={`Unpin ${active.name}`}
                    title="Unpin this LoRA"
                  >
                    ×
                  </button>
                </header>
                <div
                  className="lora-keywords"
                  aria-label={`${active.name} activation terms`}
                >
                  {active.keywords.length ? (
                    visibleKeywordIndexes.map((index) => {
                      const keyword = active.keywords[index];
                      return (
                        <div
                          className={keyword.enabled ? "" : "is-disabled"}
                          key={`${keyword.text}-${index}`}
                        >
                          <button
                            type="button"
                            aria-pressed={keyword.enabled}
                            onClick={() =>
                              changeActive(active.id, (lora) => ({
                                ...lora,
                                keywords: lora.keywords.map(
                                  (candidate, candidateIndex) =>
                                    candidateIndex === index
                                      ? {
                                          ...candidate,
                                          enabled: !candidate.enabled,
                                        }
                                      : candidate,
                                ),
                              }))
                            }
                          >
                            {keyword.text}
                          </button>
                          <input
                            type="number"
                            min="-10"
                            max="10"
                            step="0.1"
                            value={keyword.weight}
                            aria-label={`${keyword.text} prompt weight`}
                            onChange={(event) =>
                              changeActive(active.id, (lora) => ({
                                ...lora,
                                keywords: lora.keywords.map(
                                  (candidate, candidateIndex) =>
                                    candidateIndex === index &&
                                    Number.isFinite(event.target.valueAsNumber)
                                      ? {
                                          ...candidate,
                                          weight: event.target.valueAsNumber,
                                        }
                                      : candidate,
                                ),
                              }))
                            }
                          />
                        </div>
                      );
                    })
                  ) : (
                    <small>No activation terms saved.</small>
                  )}
                  {active.keywords.length > 10 && (
                    <button
                      type="button"
                      className="lora-keywords__more"
                      aria-expanded={keywordsExpanded}
                      onClick={() =>
                        setExpandedKeywordIds((current) => {
                          const next = new Set(current);
                          if (next.has(active.id)) next.delete(active.id);
                          else next.add(active.id);
                          return next;
                        })
                      }
                    >
                      {keywordsExpanded
                        ? "Show fewer"
                        : `Show ${hiddenKeywordCount} more`}
                    </button>
                  )}
                </div>
                <footer>
                  <button
                    type="button"
                    onClick={() =>
                      changeActive(active.id, (lora) => ({
                        ...lora,
                        keywords: lora.keywords.map((keyword) => ({
                          ...keyword,
                          enabled: false,
                        })),
                      }))
                    }
                  >
                    Clear terms
                  </button>
                  <button
                    type="button"
                    disabled={!source}
                    onClick={() =>
                      source &&
                      changeActive(active.id, (lora) =>
                        restoreLoraDefaults(lora, source),
                      )
                    }
                  >
                    Defaults
                  </button>
                  <button
                    type="button"
                    disabled={!source || savingId !== null}
                    onClick={() => void saveDefaults(active)}
                  >
                    {savingId === active.id ? "Saving…" : "Save defaults"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="lora-shelf__empty">
          No LoRAs pinned for the next render.
        </p>
      )}
      {saveError && (
        <p className="prompt-tools__error" role="alert">
          {saveError}
        </p>
      )}

      {libraryOpen && (
        <section className="lora-library" aria-label="LoRA library">
          <div className="lora-library__controls">
            <label className="library-search">
              <span className="sr-only">Search LoRAs</span>
              <input
                type="search"
                data-shortcut-target="ingredients"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setRandomOrder([]);
                }}
                placeholder="Name, file, folder, tag, or activation term…"
                autoFocus
              />
            </label>
            <button type="button" onClick={shuffle}>
              Random
            </button>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshLibrary()}
            >
              {refreshing ? "Refreshing…" : "Refresh library"}
            </button>
            {randomOrder.length > 0 && (
              <button type="button" onClick={() => setRandomOrder([])}>
                Relevance
              </button>
            )}
          </div>
          {refreshStatus && (
            <small className="lora-library__status" role="status">
              {refreshStatus}
            </small>
          )}
          <div className="lora-library__results">
            {loraGroups.map((group) => (
              <section className="lora-library__group" key={group.key}>
                <header>
                  <strong>{group.label}</strong>
                  <span>{group.total}</span>
                </header>
                <div className="lora-library__grid">
            {group.results.map(({ lora, match }) => {
              const pinned = activeIds.has(lora.id);
              return (
                <article key={lora.id} className={pinned ? "is-pinned" : ""}>
                  {lora.preview_url ? (
                    <img src={lora.preview_url} alt="" loading="lazy" />
                  ) : (
                    <span
                      className="lora-library__placeholder"
                      aria-hidden="true"
                    >
                      L
                    </span>
                  )}
                  <div>
                    <strong>
                      {match?.field === "Title" ? (
                        <HighlightedText
                          value={loraTitle(lora)}
                          indexes={match.indexes}
                        />
                      ) : (
                        loraTitle(lora)
                      )}
                    </strong>
                    <small>
                      {lora.model_family.toUpperCase()} · {lora.relative_path}
                    </small>
                    {match && match.field !== "Title" ? (
                      <p className="lora-library__match">
                        <span className="lora-library__match-field">
                          {match.field}
                        </span>
                        <HighlightedText
                          value={match.value}
                          indexes={match.indexes}
                        />
                      </p>
                    ) : (lora.defaults.keywords.length > 0 ||
                      lora.recommended_keywords.length > 0) && (
                      <p>
                        {(lora.defaults.keywords.map((keyword) => keyword.text)
                          .length
                          ? lora.defaults.keywords.map(
                              (keyword) => keyword.text,
                            )
                          : lora.recommended_keywords
                        )
                          .slice(0, 4)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={pinned}
                    onClick={() =>
                      onLorasChange([
                        ...activeLoras,
                        activeLoraFromCatalog(lora),
                      ])
                    }
                  >
                    {pinned ? "Pinned" : "Pin"}
                  </button>
                </article>
              );
            })}
                </div>
              </section>
            ))}
            {loraGroups.length === 0 && (
              <p className="lora-library__empty">No LoRAs match “{query}”.</p>
            )}
          </div>
        </section>
      )}

      <details className="secondary-prompt-tools">
        <summary>
          Embeddings & styles{" "}
          <span>
            {catalog.embeddings.length} · {catalog.styles.length}
          </span>
        </summary>
        <div>
          <label className="library-search">
            <span className="sr-only">Search embeddings and styles</span>
            <input
              type="search"
              value={secondarySearch}
              onChange={(event) => setSecondarySearch(event.target.value)}
              placeholder="Find an embedding or style…"
            />
          </label>
          <section>
            <h3>Embeddings</h3>
            <div className="ingredient-list ingredient-list--wrap">
              {embeddings.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => onInsert(name)}
                >
                  + {name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>Styles</h3>
            <div className="ingredient-list ingredient-list--wrap">
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
        </div>
      </details>
    </section>
  );
}
