import { useEffect, useState } from "react";

import { ForgeClient } from "../api/forge/client";
import type { ServerActivity } from "../api/forge/types";

const BUSY_POLL_MS = 400;
const IDLE_POLL_MS = 1_500;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export function useServerActivity(client: ForgeClient, refreshKey: unknown) {
  const [activity, setActivity] = useState<ServerActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();

    const poll = async () => {
      while (!abort.signal.aborted) {
        let delay = IDLE_POLL_MS;
        try {
          const next = await client.activity(abort.signal);
          if (abort.signal.aborted) return;
          setActivity(next);
          setError(null);
          delay = next.busy ? BUSY_POLL_MS : IDLE_POLL_MS;
        } catch (cause) {
          if (abort.signal.aborted) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "The server activity route did not respond.",
          );
        }
        await wait(delay, abort.signal);
      }
    };

    void poll();
    return () => abort.abort();
  }, [client, refreshKey]);

  return { activity, error };
}
