import { describe, expect, it } from "vitest";
import {
  expandPromptGroups,
  extractPromptGroup,
  removePromptGroup,
  togglePromptGroup,
  updatePromptGroup,
  type PromptGroup,
} from "./promptGroups";

describe("promptGroups", () => {
  it("extracts selected terms into a prompt group and sigil", () => {
    const prompt = "a majestic red dragon perched on obsidian rocks";
    const start = prompt.indexOf("red dragon");
    const end = start + "red dragon".length;

    const { nextPrompt, nextGroups, newGroup } = extractPromptGroup(
      prompt,
      start,
      end,
      [],
      "Dragon",
    );

    expect(newGroup.label).toBe("Dragon");
    expect(newGroup.text).toBe("red dragon");
    expect(newGroup.enabled).toBe(true);
    expect(nextPrompt).toBe(`a majestic ⟦g:${newGroup.id}⟧ perched on obsidian rocks`);
    expect(nextGroups.length).toBe(1);
  });

  it("expands prompt groups when enabled, omits when disabled", () => {
    const groups: PromptGroup[] = [
      { id: "g1", label: "Hero", text: "cyberpunk detective in neon trenchcoat", enabled: true },
      { id: "g2", label: "Weather", text: "heavy rain and thick fog", enabled: false },
    ];

    const prompt = "masterpiece portrait of ⟦g:g1⟧, ⟦g:g2⟧, cinematic lighting";
    const expanded = expandPromptGroups(prompt, groups);

    expect(expanded).toBe(
      "masterpiece portrait of cyberpunk detective in neon trenchcoat, cinematic lighting",
    );
  });

  it("toggles group enabled status", () => {
    let groups: PromptGroup[] = [
      { id: "g1", label: "Lighting", text: "volumetric god rays", enabled: true },
    ];

    groups = togglePromptGroup(groups, "g1");
    expect(groups[0].enabled).toBe(false);

    groups = togglePromptGroup(groups, "g1");
    expect(groups[0].enabled).toBe(true);
  });

  it("removes prompt group with optional inlining", () => {
    const groups: PromptGroup[] = [
      { id: "g1", label: "Style", text: "oil painting by Rembrandt", enabled: true },
    ];
    const prompt = "portrait of a scholar, ⟦g:g1⟧";

    // Without inlining (sigil stripped)
    const withoutInline = removePromptGroup(prompt, groups, "g1", false);
    expect(withoutInline.nextPrompt).toBe("portrait of a scholar,");
    expect(withoutInline.nextGroups.length).toBe(0);

    // With inlining (sigil replaced by original text)
    const withInline = removePromptGroup(prompt, groups, "g1", true);
    expect(withInline.nextPrompt).toBe("portrait of a scholar, oil painting by Rembrandt");
  });

  it("updates prompt group label and text", () => {
    let groups: PromptGroup[] = [
      { id: "g1", label: "Hero", text: "young warrior", enabled: true },
    ];

    groups = updatePromptGroup(groups, "g1", {
      label: "Veteran Hero",
      text: "scarred battle-hardened knight",
    });

    expect(groups[0].label).toBe("Veteran Hero");
    expect(groups[0].text).toBe("scarred battle-hardened knight");
  });
});
