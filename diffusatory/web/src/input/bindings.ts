import type { PointerEventLike, PointerKind } from "./pointer";

export type TabletAction =
  | "draw-paint"
  | "draw-mask"
  | "erase"
  | "pan"
  | "eyedropper"
  | "toggle-paint-mask"
  | "brush-size"
  | "brush-opacity";

export type BindingBehavior = "hold" | "toggle";

/**
 * An observed browser signature, not a hard-coded Wacom or Huion mapping.
 * `button` identifies the control which changed on pointerdown/up while
 * `buttons` preserves the bitmask for diagnosis and profile editing.
 */
export interface PointerBindingSignature {
  kind: PointerKind;
  button: number;
  buttons: number;
}

export interface TabletBinding {
  action: TabletAction;
  behavior: BindingBehavior;
  signature: PointerBindingSignature;
}

export interface TabletProfile {
  schemaVersion: 1;
  name: string;
  bindings: TabletBinding[];
}

function pointerKind(pointerType: string): PointerKind {
  if (pointerType === "pen" || pointerType === "touch") return pointerType;
  return "mouse";
}

export function captureBindingSignature(
  event: Pick<PointerEventLike, "pointerType" | "button" | "buttons">,
): PointerBindingSignature {
  return {
    kind: pointerKind(event.pointerType),
    button: event.button,
    buttons: event.buttons,
  };
}

export function bindingMatches(
  binding: TabletBinding,
  event: Pick<PointerEventLike, "pointerType" | "button">,
): boolean {
  return (
    binding.signature.kind === pointerKind(event.pointerType) &&
    binding.signature.button === event.button
  );
}

export function createTabletProfile(name: string): TabletProfile {
  return {
    schemaVersion: 1,
    name: name.trim() || "Tablet",
    bindings: [],
  };
}

