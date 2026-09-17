import { useEffect, useState } from "react";

import { ForgeClient } from "../api/forge/client";
import type { ServerActivity } from "../api/forge/types";

const BUSY_POLL_MS = 400;
const IDLE_POLL_MS = 1_500;
// After the stream drops, poll for this long before trying the stream again.
const STREAM_RETRY_MS = 10_000;

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

function describe(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Server activity, pushed over the status stream; polled only while the
 * stream is unavailable.
 */
export function useServerActivity(client: ForgeClient, refreshKey: unknown) {
  const [activity, setActivity] = useState<ServerActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    let busy = false;

    const receive = (next: ServerActivity) => {
      if (signal.aborted) return;
      busy = next.busy;
      setActivity(next);
      setError(null);
    };

    const pollUntil = async (deadline: number) => {
      while (!signal.aborted && Date.now() < deadline) {
        try {
          receive(await client.activity(signal));
        } catch (cause) {
          if (signal.aborted) return;
          setError(describe(cause, "The server activity route did not respond."));
        }
        await wait(busy ? BUSY_POLL_MS : IDLE_POLL_MS, signal);
      }
    };

    const run = async () => {
      while (!signal.aborted) {
        try {
          await client.activityStream(receive, signal);
        } catch (cause) {
          if (signal.aborted) return;
          setError(describe(cause, "The server activity stream dropped."));
        }
        if (signal.aborted) return;
        await pollUntil(Date.now() + STREAM_RETRY_MS);
      }
    };

    void run();
    return () => abort.abort();
  }, [client, refreshKey]);

  return { activity, error };
}
