import { describe, expect, it } from "vitest";

import type { Lora } from "../api/forge/types";
import {
  activeLoraFromCatalog,
  compilePromptWithLoras,
  loraSearchMatch,
  loraSearchScore,
  promptContainsTerm,
  visibleLoraKeywordIndexes,
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
    expect(loraSearchMatch(catalogLora, "qturn")).toMatchObject({
      group: "identity",
      field: "Title",
      value: "quiet-turn",
      indexes: [0, 4, 7, 8, 9],
    });
    expect(loraSearchMatch(catalogLora, "profile")).toMatchObject({
      group: "tags",
      field: "Tag",
      value: "profile",
    });
    expect(loraSearchScore(catalogLora, "unrelated words")).toBeNull();
  });

  it("groups by the first matching surface rather than flattening metadata", () => {
    const tagOnly = {
      ...catalogLora,
      name: "camera-angle",
      alias: "camera-angle",
      relative_path: "composition/camera-angle.safetensors",
      tags: ["soft profile"],
    };
    expect(loraSearchMatch(tagOnly, "soft profile")).toMatchObject({
      group: "tags",
      field: "Tag",
    });

    const activationOnly = { ...tagOnly, tags: ["pose"] };
    expect(loraSearchMatch(activationOnly, "soft profile")).toMatchObject({
      group: "activation",
      field: "Activation",
    });
  });

  it("does not let tiny fuzzy queries match most of the catalog", () => {
    expect(loraSearchMatch(catalogLora, "qt")).toBeNull();
    expect(loraSearchMatch(catalogLora, "quiet")).not.toBeNull();
  });

  it("does not manufacture filename matches from the model extension", () => {
    const sparse = {
      ...catalogLora,
      name: "breath_weapon",
      alias: "breath_weapon",
      relative_path: "Combat and Workout/breath_weapon.safetensors",
      description: "",
      tags: [],
      recommended_keywords: [],
      defaults: { ...catalogLora.defaults, description: "", keywords: [], notes: "" },
    };
    expect(loraSearchMatch(sparse, "pose")).toBeNull();
  });

  it("keeps selected terms visible while limiting disabled suggestions", () => {
    const keywords = Array.from({ length: 15 }, (_, index) => ({
      text: `term ${index}`,
      weight: 1,
      enabled: index >= 10,
    }));
    expect(visibleLoraKeywordIndexes(keywords, false)).toEqual([
      0, 1, 2, 3, 4, 10, 11, 12, 13, 14,
    ]);
    expect(visibleLoraKeywordIndexes(keywords, true)).toHaveLength(15);
  });

  it("offers no disabled suggestions once ten terms are selected", () => {
    const keywords = Array.from({ length: 15 }, (_, index) => ({
      text: `term ${index}`,
      weight: 1,
      enabled: index < 10,
    }));
    expect(visibleLoraKeywordIndexes(keywords, false)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});
