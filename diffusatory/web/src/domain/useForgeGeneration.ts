import { useCallback, useEffect, useReducer, useRef } from "react";

import { createTaskId, ForgeClient } from "../api/forge/client";
import type { Txt2ImgInput } from "../api/forge/types";
import {
  generationReducer,
  initialGenerationState,
  isGenerating,
} from "./generation";

const POLL_INTERVAL_MS = 500;

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Forge returned an unknown error.";
}

export function useForgeGeneration(client: ForgeClient) {
  const [state, dispatch] = useReducer(
    generationReducer,
    initialGenerationState,
  );
  const mounted = useRef(true);
  const runNumber = useRef(0);
  const currentAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      currentAbort.current?.abort();
    };
  }, []);

  const generate = useCallback(
    async (input: Txt2ImgInput) => {
      if (currentAbort.current || isGenerating(state.phase)) return;

      const run = ++runNumber.current;
      const taskId = createTaskId();
      const abort = new AbortController();
      currentAbort.current = abort;
      dispatch({ type: "started", taskId });

      let polling = true;
      let previewId = -1;
      const poll = async () => {
        while (polling && !abort.signal.aborted && run === runNumber.current) {
          try {
            const progress = await client.progress(
              taskId,
              previewId,
              abort.signal,
            );
            if (progress.id_live_preview !== null) {
              previewId = progress.id_live_preview;
            }
            if (mounted.current && run === runNumber.current) {
              dispatch({ type: "progress", value: progress });
            }
          } catch (error) {
            if (!abort.signal.aborted) {
              console.warn("Diffusatory progress update failed", error);
            }
          }
          await delay(POLL_INTERVAL_MS, abort.signal);
        }
      };

      const pollPromise = poll();
      try {
        const result = await client.txt2img(taskId, input, abort.signal);
        if (mounted.current && run === runNumber.current) {
          dispatch({ type: "completed", value: result });
        }
      } catch (error) {
        if (mounted.current && run === runNumber.current) {
          dispatch({ type: "failed", error: errorMessage(error) });
        }
      } finally {
        polling = false;
        await pollPromise;
        if (currentAbort.current === abort) currentAbort.current = null;
      }
    },
    [client, state.phase],
  );

  const interrupt = useCallback(async () => {
    if (!isGenerating(state.phase)) return;
    try {
      await client.interrupt();
      if (mounted.current) dispatch({ type: "interrupt-requested" });
    } catch (error) {
      if (mounted.current) {
        dispatch({
          type: "control-failed",
          error: `Interrupt request failed: ${errorMessage(error)}`,
        });
      }
    }
  }, [client, state.phase]);

  return {
    state,
    generate,
    interrupt,
    reset: () => dispatch({ type: "reset" }),
    generating: isGenerating(state.phase),
  };
}
