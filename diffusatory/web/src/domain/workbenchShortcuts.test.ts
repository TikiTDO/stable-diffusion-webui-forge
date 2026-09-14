import { describe, expect, it } from "vitest";

import { workbenchShortcutFor } from "./workbenchShortcuts";

const event = (
  key: string,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("workbench shortcuts", () => {
  it("routes the main workbench focus keys", () => {
    expect(workbenchShortcutFor(event("P", { altKey: true }))).toEqual({
      kind: "focus",
      target: "prompt",
    });
    expect(workbenchShortcutFor(event("m", { altKey: true }))).toEqual({
      kind: "focus",
      target: "model",
    });
    expect(workbenchShortcutFor(event("P", { altKey: true, shiftKey: true }))).toEqual({
      kind: "focus",
      target: "negative-prompt",
    });
  });

  it("offers generation both from the standard chord and the left hand", () => {
    expect(workbenchShortcutFor(event("Enter", { ctrlKey: true }))).toEqual({
      kind: "generate",
      operation: "default",
    });
    expect(workbenchShortcutFor(event("G", { altKey: true, shiftKey: true }))).toEqual({
      kind: "generate",
      operation: "masked",
    });
    expect(workbenchShortcutFor(event("W", { altKey: true }))).toEqual({
      kind: "generate",
      operation: "whole",
    });
  });

  it("does not steal ordinary typing", () => {
    expect(workbenchShortcutFor(event("p"))).toBeNull();
    expect(workbenchShortcutFor(event("p", { ctrlKey: true }))).toBeNull();
  });
});
