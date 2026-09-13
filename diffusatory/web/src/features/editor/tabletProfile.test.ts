import { afterEach, describe, expect, it, vi } from "vitest";

import { createTabletProfile } from "../../input/bindings";
import { loadTabletProfile, saveTabletProfile } from "./tabletProfile";

function installStorage(initial: string | null = null) {
  let stored = initial;
  const localStorage = {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((_key: string, value: string) => {
      stored = value;
    }),
  };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}

describe("tablet profiles", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back instead of accepting an unknown persisted action", () => {
    installStorage(
      JSON.stringify({
        schemaVersion: 1,
        name: "Broken",
        bindings: [
          {
            action: "launch-missiles",
            behavior: "toggle",
            signature: { kind: "pen", button: 2, buttons: 2 },
          },
        ],
      }),
    );

    expect(loadTabletProfile()).toMatchObject({
      name: "My tablet",
      bindings: [],
    });
  });

  it("persists a profile without changing its observed binding", () => {
    const localStorage = installStorage();
    const profile = createTabletProfile("Wacom desk");
    profile.bindings.push({
      action: "toggle-paint-mask",
      behavior: "toggle",
      signature: { kind: "pen", button: 2, buttons: 2 },
    });

    saveTabletProfile(profile);

    expect(localStorage.setItem).toHaveBeenCalledOnce();
    expect(loadTabletProfile()).toEqual(profile);
  });
});
