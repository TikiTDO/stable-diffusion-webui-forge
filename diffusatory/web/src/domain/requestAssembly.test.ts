import { describe, expect, it } from "vitest";
import { starterDraft, requestFromDraft } from "./draft";
import {
  expandPromptGroups,
  extractPromptGroup,
  moveGroupSigil,
  removePromptGroup,
  type PromptGroup,
} from "./promptGroups";
import { compilePromptWithLoras } from "./loras";

describe("request assembly and prompt group resolution", () => {
  it("resolves prompt groups without leaking sigils into generation request", () => {
    const groups: PromptGroup[] = [
      { id: "subject", label: "Hero", text: "cyberpunk detective", enabled: true },
      { id: "lighting", label: "Lighting", text: "volumetric neon rays", enabled: true },
      { id: "weather", label: "Weather", text: "heavy acid rain", enabled: false },
    ];

    const draft = {
      ...starterDraft,
      prompt: "masterpiece portrait of ⟦g:subject⟧ in an alleyway, ⟦g:lighting⟧, ⟦g:weather⟧",
      promptGroups: groups,
    };

    // 1. requestFromDraft expands groups
    const baseRequest = requestFromDraft(draft);
    expect(baseRequest.prompt).toBe(
      "masterpiece portrait of cyberpunk detective in an alleyway, volumetric neon rays",
    );
    expect(baseRequest.prompt).not.toContain("⟦g:");

    // 2. Realization mapping in App.tsx assembly:
    // Simulated realizations produced from expanded prompt
    const simulatedRealizations = [
      { prompt: expandPromptGroups(draft.prompt, draft.promptGroups), negative_prompt: "" },
    ];
    const finalPrompts = simulatedRealizations.map((item) =>
      compilePromptWithLoras(
        expandPromptGroups(item.prompt, draft.promptGroups),
        draft.loras,
      ),
    );

    expect(finalPrompts[0]).toBe(
      "masterpiece portrait of cyberpunk detective in an alleyway, volumetric neon rays",
    );
    expect(finalPrompts[0]).not.toContain("⟦g:");
  });

  it("handles prompt group extraction and token repositioning in assembly", () => {
    let prompt = "a serene mountain lake with ancient pine trees under starlight";
    const groups: PromptGroup[] = [];

    // Extract "ancient pine trees"
    const start = prompt.indexOf("ancient pine trees");
    const end = start + "ancient pine trees".length;
    const extracted = extractPromptGroup(prompt, start, end, groups, "Trees");

    expect(extracted.nextPrompt).toContain(`⟦g:${extracted.newGroup.id}⟧`);
    expect(extracted.nextGroups).toHaveLength(1);

    // Move token to start of prompt
    const moved = moveGroupSigil(extracted.nextPrompt, extracted.newGroup.id, 0);
    expect(moved.startsWith(`⟦g:${extracted.newGroup.id}⟧`)).toBe(true);

    // Assembly expands in new position
    const expanded = expandPromptGroups(moved, extracted.nextGroups);
    expect(expanded.startsWith("ancient pine trees a serene mountain lake")).toBe(true);
    expect(expanded).not.toContain("⟦g:");
  });
});
