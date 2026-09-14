import type { EditorLayer, EditorTool } from "./model";

export type EditorShortcut =
  | { kind: "tool"; tool: EditorTool }
  | { kind: "layer"; layer: EditorLayer }
  | { kind: "brush-size"; direction: -1 | 1 }
  | { kind: "wheel-target"; target: "brush-size" }
  | { kind: "temporary-pan" }
  | { kind: "save" }
  | { kind: "undo" };

export interface EditorShortcutKey {
  code?: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

const codeOf = ({ code, key }: EditorShortcutKey): string => {
  if (code) return code;
  if (key === " ") return "Space";
  if (key.length === 1 && /[a-z]/iu.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  return key;
};

/**
 * The drawing hand stays on the pen or mouse. Shortcuts therefore occupy one
 * compact left-hand QWERTY cluster instead of following application-wide
 * mnemonic conventions.
 */
export function editorShortcutFor(key: EditorShortcutKey): EditorShortcut | null {
  const code = codeOf(key);
  if (key.ctrlKey || key.metaKey) {
    if (code === "KeyZ") return { kind: "undo" };
    if (code === "KeyS") return { kind: "save" };
    return null;
  }
  if (key.shiftKey && code === "KeyB") {
    return { kind: "wheel-target", target: "brush-size" };
  }

  switch (code) {
    case "KeyQ":
      return { kind: "layer", layer: "paint" };
    case "KeyW":
      return { kind: "layer", layer: "mask" };
    case "KeyA":
      return { kind: "tool", tool: "brush" };
    case "KeyS":
      return { kind: "tool", tool: "erase" };
    case "KeyD":
      return { kind: "tool", tool: "eyedropper" };
    case "KeyF":
      return { kind: "tool", tool: "pan" };
    case "KeyZ":
      return { kind: "undo" };
    case "KeyC":
      return { kind: "brush-size", direction: -1 };
    case "KeyV":
      return { kind: "brush-size", direction: 1 };
    case "Space":
      return { kind: "temporary-pan" };
    default:
      return null;
  }
}
