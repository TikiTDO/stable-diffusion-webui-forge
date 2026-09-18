import { describe, expect, it } from "vitest";
import { starterDraft, requestFromDraft } from "./draft";
import {
  expandPromptGroups,
  extractPromptGroup,
  moveGroupSigil,
  type PromptGroup,
} from "./promptGroups";
import {
  assembleGenerationRequest,
  buildPromptExpansionInput,
} from "./requestAssembly";

describe("production request assembly and prompt group resolution", () => {
  it("builds prompt expansion input with expanded groups", () => {
    const groups: PromptGroup[] = [
      { id: "hero", label: "Hero", text: "cyberpunk detective", enabled: true },
      { id: "weather", label: "Weather", text: "heavy acid rain", enabled: false },
    ];
    const draft = {
      ...starterDraft,
      prompt: "portrait of ⟦g:hero⟧, ⟦g:weather⟧",
      promptGroups: groups,
      outputs: 2,
    };

    const expansionInput = buildPromptExpansionInput(draft, "random", 42);
    expect(expansionInput.prompt).toBe("portrait of cyberpunk detective");
    expect(expansionInput.prompt).not.toContain("⟦g:");
    expect(expansionInput.candidateCount).toBe(2);
    expect(expansionInput.expansionSeed).toBe(42);
  });

  it("assembles production generation request without leaking sigils into Forge", () => {
    const groups: PromptGroup[] = [
      { id: "subject", label: "Hero", text: "cyberpunk detective", enabled: true },
      { id: "lighting", label: "Lighting", text: "volumetric neon rays", enabled: true },
      { id: "weather", label: "Weather", text: "heavy acid rain", enabled: false },
    ];

    const draft = {
      ...starterDraft,
      prompt: "masterpiece portrait of ⟦g:subject⟧ in an alleyway, ⟦g:lighting⟧, ⟦g:weather⟧",
      promptGroups: groups,
      negativePrompt: "lowres, blurry",
    };

    // 1. Base draft request expansion
    const baseRequest = requestFromDraft(draft);
    expect(baseRequest.prompt).toBe(
      "masterpiece portrait of cyberpunk detective in an alleyway, volumetric neon rays",
    );
    expect(baseRequest.prompt).not.toContain("⟦g:");

    // 2. Production request assembler handling multiple realizations (e.g. from prompt expansion or dynamic prompts)
    const request = assembleGenerationRequest({
      draft,
      realizations: [
        {
          prompt: "realized portrait of ⟦g:subject⟧ under spotlight, ⟦g:lighting⟧",
          negative_prompt: "ugly, distorted",
        },
        {
          prompt: "cinematic close-up of ⟦g:subject⟧, ⟦g:weather⟧",
          negative_prompt: "bad hands",
        },
      ],
    });

    expect(Array.isArray(request.prompt)).toBe(true);
    const prompts = request.prompt as string[];
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(
      "realized portrait of cyberpunk detective under spotlight, volumetric neon rays",
    );
    expect(prompts[0]).not.toContain("⟦g:");
    expect(prompts[1]).toBe("cinematic close-up of cyberpunk detective");
    expect(prompts[1]).not.toContain("⟦g:");

    // Negative prompts preserved
    expect(request.negativePrompt).toEqual(["ugly, distorted", "bad hands"]);
    expect(request.outputs).toBe(2);

    // Composition snapshot preserved with full fidelity
    expect(request.composition).toBeDefined();
    const comp = request.composition as any;
    expect(comp.version).toBe(1);
    expect(comp.promptGroups).toHaveLength(3);
  });

  it("handles prompt group extraction and token repositioning through assembly", () => {
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

    // Production assembly expands token in new position
    const draft = {
      ...starterDraft,
      prompt: moved,
      promptGroups: extracted.nextGroups,
    };
    const request = assembleGenerationRequest({
      draft,
      realizations: [{ prompt: moved, negative_prompt: "" }],
    });

    const assembledPrompt = (request.prompt as string[])[0];
    expect(assembledPrompt.startsWith("ancient pine trees a serene mountain lake")).toBe(true);
    expect(assembledPrompt).not.toContain("⟦g:");
  });
});
