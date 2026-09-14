export type WorkbenchShortcut =
  | { kind: "focus"; target: string }
  | { kind: "activate"; target: string }
  | { kind: "generate"; operation: "default" | "masked" | "whole" }
  | { kind: "help" }
  | { kind: "close" };

interface ShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const FOCUS_KEYS: Record<string, string> = {
  p: "prompt",
  m: "model",
  f: "frame",
  r: "render",
  n: "candidates",
  s: "seed",
  i: "ingredients",
  t: "tools",
};

const ACTION_KEYS: Record<string, string> = {
  d: "draw",
  o: "open-image",
  v: "variants",
  e: "editor",
  l: "regions",
  k: "skip",
  x: "cancel",
};

export function workbenchShortcutFor(event: ShortcutEvent): WorkbenchShortcut | null {
  if (event.key === "Escape") return { kind: "close" };
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    return { kind: "generate", operation: event.shiftKey ? "masked" : "default" };
  }
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key.toLocaleLowerCase();
  if (key === "/" || key === "?") return { kind: "help" };
  if (key === "g") {
    return { kind: "generate", operation: event.shiftKey ? "masked" : "default" };
  }
  if (key === "w") return { kind: "generate", operation: "whole" };
  if (event.shiftKey && key === "p") return { kind: "focus", target: "negative-prompt" };
  if (event.shiftKey && key === "f") return { kind: "focus", target: "frame-height" };
  if (event.shiftKey && key === "r") return { kind: "focus", target: "scheduler" };
  const focusTarget = FOCUS_KEYS[key];
  if (focusTarget) return { kind: "focus", target: focusTarget };
  const actionTarget = ACTION_KEYS[key];
  if (actionTarget) return { kind: "activate", target: actionTarget };
  return null;
}
