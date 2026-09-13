import { useEffect, useMemo, useState } from "react";

import type { ForgeClient } from "../api/forge/client";
import type {
  PromptExpansionInput,
  PromptExpansionResponse,
} from "../api/forge/types";

const PREVIEW_DEBOUNCE_MS = 250;

interface ExpansionSnapshot {
  key: string;
  response: PromptExpansionResponse | null;
  error: string | null;
}

function inputKey(input: PromptExpansionInput): string {
  return JSON.stringify(input);
}

export function usePromptExpansion(
  client: ForgeClient,
  input: PromptExpansionInput,
  enabled: boolean,
) {
  const key = useMemo(() => inputKey(input), [input]);
  const [snapshot, setSnapshot] = useState<ExpansionSnapshot>({
    key: "",
    response: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => {
      void client
        .expandPrompts(input, abort.signal)
        .then((response) => {
          if (!abort.signal.aborted) setSnapshot({ key, response, error: null });
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          setSnapshot({
            key,
            response: null,
            error:
              error instanceof Error
                ? error.message
                : "Prompt preview could not be generated.",
          });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [client, enabled, input, key]);

  const current = snapshot.key === key ? snapshot : null;
  return {
    response: current?.response ?? null,
    error: current?.error ?? null,
    loading: enabled && current === null,
  };
}
