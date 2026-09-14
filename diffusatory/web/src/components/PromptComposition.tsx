import type {
  PromptExpansionMode,
  PromptExpansionResponse,
} from "../api/forge/types";
import { NumberInput } from "./NumberInput";

interface PromptCompositionProps {
  mode: PromptExpansionMode;
  expansionSeed: number;
  response: PromptExpansionResponse | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  onModeChange: (mode: PromptExpansionMode) => void;
  onExpansionSeedChange: (seed: number) => void;
  onShuffle: () => void;
}

const MODES: Array<{
  mode: PromptExpansionMode;
  label: string;
  detail: string;
}> = [
  {
    mode: "off",
    label: "As written",
    detail: "Repeat this exact prompt",
  },
  {
    mode: "random",
    label: "Variations",
    detail: "Resolve a different branch for each image",
  },
  {
    mode: "exhaustive",
    label: "Every branch",
    detail: "Walk combinations up to the candidate cap",
  },
];

export function PromptComposition({
  mode,
  expansionSeed,
  response,
  loading,
  error,
  actionError,
  onModeChange,
  onExpansionSeedChange,
  onShuffle,
}: PromptCompositionProps) {
  const visibleRealizations = response
    ? mode === "off"
      ? response.realizations.slice(0, 1)
      : response.realizations
    : [];

  return (
    <section className="prompt-composition" aria-label="Prompt variations">
      <div className="prompt-composition__modes">
        {MODES.map((candidate) => (
          <button
            key={candidate.mode}
            type="button"
            className={mode === candidate.mode ? "is-selected" : ""}
            onClick={() => onModeChange(candidate.mode)}
            title={candidate.detail}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {mode === "random" && (
        <div className="variation-seed">
          <label>
            <span>Prompt-set seed</span>
            <NumberInput
              min="0"
              max="2147483647"
              value={expansionSeed}
              clamp={(value) => Math.min(2147483647, Math.max(0, value))}
              onValueChange={onExpansionSeedChange}
            />
          </label>
          <button type="button" onClick={onShuffle}>
            New set
          </button>
        </div>
      )}

      <div className="prompt-preview" aria-live="polite">
        <header>
          <strong>Prompt set</strong>
          <span>
            {loading
              ? "Resolving…"
              : response
                ? `${response.resolved_count} ${
                    response.resolved_count === 1 ? "image" : "images"
                  }`
                : "Unavailable"}
          </span>
        </header>
        {(error || actionError) && (
          <p className="prompt-preview__error" role="alert">
            {actionError ?? error}
          </p>
        )}
        {response?.issues.map((issue) => (
          <p
            className="prompt-preview__error"
            role="alert"
            key={`${issue.field}-${issue.code}-${issue.message}`}
          >
            {issue.message}
          </p>
        ))}
        {response?.truncated && (
          <p className="prompt-preview__note">
            More combinations exist. Increase Candidates to include more.
          </p>
        )}
        {visibleRealizations.length > 0 && (
          <ol>
            {visibleRealizations.map((realization) => (
              <li key={`${realization.index}-${realization.prompt}`}>
                <span>{realization.prompt || "(empty positive prompt)"}</span>
                {realization.negative_prompt && (
                  <small>without: {realization.negative_prompt}</small>
                )}
              </li>
            ))}
          </ol>
        )}
        {response && mode === "off" && response.resolved_count > 1 && (
          <small className="prompt-preview__repeat">
            Repeated for all {response.resolved_count} candidates.
          </small>
        )}
      </div>

      <details className="prompt-syntax">
        <summary>Prompt syntax legend</summary>
        <dl>
          <div>
            <dt><code>{"{dawn|dusk|night}"}</code></dt>
            <dd>choose one branch</dd>
          </div>
          <div>
            <dt><code>{"{0.7::warm|0.3::cold}"}</code></dt>
            <dd>weighted branches</dd>
          </div>
          <div>
            <dt><code>{"{2$$ and $$red|blue|gold}"}</code></dt>
            <dd>choose several without repeats</dd>
          </div>
          <div>
            <dt><code>__lighting__</code></dt>
            <dd>choose from data/wildcards/lighting.txt</dd>
          </div>
          <div>
            <dt><code>{"${tone={warm|cool}} ${tone}"}</code></dt>
            <dd>define and reuse a variable</dd>
          </div>
          <div>
            <dt><code>{"# hidden note"}</code></dt>
            <dd>comments occupy their own line</dd>
          </div>
        </dl>
        <small>
          Preview and Generate use the same native compiler. Jinja and Magic
          Prompt are intentionally not enabled.
        </small>
      </details>
    </section>
  );
}
