import { describe, expect, it } from "vitest";

import type { Lora } from "../api/forge/types";
import {
  activeLoraFromCatalog,
  compilePromptWithLoras,
  loraSearchScore,
  promptContainsTerm,
} from "./loras";

const catalogLora: Lora = {
  id: "lora-one",
  name: "quiet-turn",
  alias: "quiet-turn",
  reference: "quiet-turn",
  relative_path: "poses/quiet-turn.safetensors",
  folders: ["poses"],
  modified_at: 1,
  size_bytes: 100,
  model_family: "sdxl",
  base_model: "Illustrious",
  preview_url: null,
  description: "Turns a subject gently",
  tags: ["pose", "profile"],
  recommended_keywords: ["quiet turn"],
  defaults: {
    description: "Turns a subject gently",
    model_family: "sdxl",
    preferred_strength: 0.8,
    keywords: [
      { text: "quiet turn", weight: 1, enabled: true },
      { text: "soft profile", weight: 1.2, enabled: true },
    ],
    notes: "",
  },
};

describe("LoRA prompt composition", () => {
  it("keeps adapter strength and activation-term attention independent", () => {
    const active = activeLoraFromCatalog(catalogLora);
    expect(compilePromptWithLoras("a woman", [active])).toBe(
      "a woman, quiet turn, (soft profile:1.2), <lora:quiet-turn:0.8>",
    );
  });

  it("does not duplicate a human-authored term or delete authored text", () => {
    const active = activeLoraFromCatalog(catalogLora);
    expect(promptContainsTerm("a quiet_turn at dusk", "quiet turn")).toBe(true);
    expect(compilePromptWithLoras("a quiet turn at dusk", [active])).toBe(
      "a quiet turn at dusk, (soft profile:1.2), <lora:quiet-turn:0.8>",
    );
    active.enabled = false;
    expect(compilePromptWithLoras("a quiet turn at dusk", [active])).toBe(
      "a quiet turn at dusk",
    );
  });

  it("deduplicates terms contributed by multiple enabled LoRAs", () => {
    const first = activeLoraFromCatalog(catalogLora);
    const second = { ...activeLoraFromCatalog(catalogLora), id: "two", reference: "two" };
    expect(compilePromptWithLoras("portrait", [first, second])).toBe(
      "portrait, quiet turn, (soft profile:1.2), <lora:quiet-turn:0.8>, <lora:two:0.8>",
    );
  });

  it("respects an adapter directive already present in imported prompt text", () => {
    const active = activeLoraFromCatalog(catalogLora);
    expect(
      compilePromptWithLoras("portrait, <lora:quiet-turn:0.6>", [active]),
    ).toBe(
      "portrait, <lora:quiet-turn:0.6>, quiet turn, (soft profile:1.2)",
    );
  });

  it("finds fuzzy names, paths, tags, and recommended vocabulary", () => {
    expect(loraSearchScore(catalogLora, "qturn")).not.toBeNull();
    expect(loraSearchScore(catalogLora, "profile")).not.toBeNull();
    expect(loraSearchScore(catalogLora, "unrelated words")).toBeNull();
  });
});
