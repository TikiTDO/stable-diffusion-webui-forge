import { describe, expect, it } from "vitest";

import { editorShortcutFor } from "./shortcuts";

describe("editorShortcutFor", () => {
  it("keeps all persistent drawing tools on the left-hand home row", () => {
    expect(editorShortcutFor({ code: "KeyA", key: "a" })).toEqual({
      kind: "tool",
      tool: "brush",
    });
    expect(editorShortcutFor({ code: "KeyS", key: "s" })).toEqual({
      kind: "tool",
      tool: "erase",
    });
    expect(editorShortcutFor({ code: "KeyD", key: "d" })).toEqual({
      kind: "tool",
      tool: "eyedropper",
    });
    expect(editorShortcutFor({ code: "KeyF", key: "f" })).toEqual({
      kind: "tool",
      tool: "pan",
    });
  });

  it("uses the surrounding left-hand keys for layers, size, and temporary pan", () => {
    expect(editorShortcutFor({ code: "KeyQ", key: "q" })).toEqual({
      kind: "layer",
      layer: "paint",
    });
    expect(editorShortcutFor({ code: "KeyW", key: "w" })).toEqual({
      kind: "layer",
      layer: "mask",
    });
    expect(editorShortcutFor({ code: "KeyC", key: "c" })).toEqual({
      kind: "brush-size",
      direction: -1,
    });
    expect(editorShortcutFor({ code: "KeyV", key: "v" })).toEqual({
      kind: "brush-size",
      direction: 1,
    });
    expect(editorShortcutFor({ code: "Space", key: " " })).toEqual({
      kind: "temporary-pan",
    });
  });

  it("keeps save and undo behind the control modifier", () => {
    expect(
      editorShortcutFor({ code: "KeyS", key: "s", ctrlKey: true }),
    ).toEqual({ kind: "save" });
    expect(
      editorShortcutFor({ code: "KeyZ", key: "z", metaKey: true }),
    ).toEqual({ kind: "undo" });
  });

  it("uses a chord to route the wheel to brush size", () => {
    expect(
      editorShortcutFor({ code: "KeyB", key: "B", shiftKey: true }),
    ).toEqual({ kind: "wheel-target", target: "brush-size" });
  });
});
