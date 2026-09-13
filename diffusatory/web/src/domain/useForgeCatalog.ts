import { useCallback, useEffect, useState } from "react";

import { ForgeClient } from "../api/forge/client";
import type { ForgeCatalog } from "../api/forge/types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Forge catalog unavailable";
}

export function useForgeCatalog(client: ForgeClient) {
  const [catalog, setCatalog] = useState<ForgeCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const next = await client.catalog(signal);
        setCatalog(next);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

  return { catalog, error, loading, reload: () => void load() };
}
