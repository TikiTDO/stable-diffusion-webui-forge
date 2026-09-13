import {
  createTabletProfile,
  type BindingBehavior,
  type PointerBindingSignature,
  type TabletAction,
  type TabletBinding,
  type TabletProfile,
} from "../../input/bindings";
import { DEFAULT_PRESSURE_CALIBRATION } from "../../input/calibration";

const PROFILE_STORAGE_KEY = "diffusatory.tablet-profile.v1";
const TABLET_ACTIONS: TabletAction[] = [
  "draw-paint",
  "draw-mask",
  "erase",
  "pan",
  "eyedropper",
  "toggle-paint-mask",
  "brush-size",
  "brush-opacity",
];

export interface PendingBinding {
  action: TabletAction;
  behavior: BindingBehavior;
  signature: PointerBindingSignature;
  conflict: TabletBinding | null;
}

export interface BindableAction {
  action: TabletAction;
  label: string;
  behavior: BindingBehavior;
}

export const BINDABLE_ACTIONS: BindableAction[] = [
  { action: "toggle-paint-mask", label: "Paint ↔ mask", behavior: "toggle" },
  { action: "erase", label: "Eraser", behavior: "hold" },
  { action: "pan", label: "Pan", behavior: "hold" },
  { action: "eyedropper", label: "Eyedropper", behavior: "hold" },
];

function isTabletProfile(value: unknown): value is TabletProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<TabletProfile>;
  return (
    profile.schemaVersion === 1 &&
    typeof profile.name === "string" &&
    Array.isArray(profile.bindings) &&
    profile.bindings.every(
      (binding) =>
        binding &&
        TABLET_ACTIONS.includes(binding.action) &&
        (binding.behavior === "hold" || binding.behavior === "toggle") &&
        binding.signature &&
        ["pen", "touch", "mouse"].includes(binding.signature.kind) &&
        Number.isInteger(binding.signature.button) &&
        Number.isInteger(binding.signature.buttons),
    )
  );
}

export function loadTabletProfile(): TabletProfile {
  try {
    const value = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!value) return createTabletProfile("My tablet");
    const parsed: unknown = JSON.parse(value);
    if (isTabletProfile(parsed)) {
      return {
        ...parsed,
        pressure: {
          ...DEFAULT_PRESSURE_CALIBRATION,
          ...(parsed.pressure ?? {}),
        },
      };
    }
  } catch {
    // A broken browser preference must not take the editor down with it.
  }
  return createTabletProfile("My tablet");
}

export function saveTabletProfile(profile: TabletProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private browsing or storage policy must not disable drawing.
  }
}

export function signatureLabel(signature: PointerBindingSignature): string {
  return `${signature.kind} button ${signature.button}`;
}
