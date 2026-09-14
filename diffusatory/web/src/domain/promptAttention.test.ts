import { describe, expect, it } from "vitest";

import { adjustPromptAttention } from "./promptAttention";

describe("prompt attention keyboard editing", () => {
  it("weights the current word when there is no selection", () => {
    expect(adjustPromptAttention("red lantern", 1, 1, 1)).toEqual({
      text: "(red:1.1) lantern",
      selectionStart: 1,
      selectionEnd: 4,
    });
  });

  it("weights selected text rather than guessing a word", () => {
    expect(adjustPromptAttention("soft rim light", 5, 14, -1)?.text).toBe(
      "soft (rim light:0.9)",
    );
  });

  it("adjusts an enclosing weighted block and unwraps one", () => {
    expect(adjustPromptAttention("a (quiet turn:1.2), dusk", 10, 10, -1)?.text).toBe(
      "a (quiet turn:1.1), dusk",
    );
    expect(adjustPromptAttention("a (quiet turn:1.1), dusk", 10, 10, -1)).toEqual({
      text: "a quiet turn, dusk",
      selectionStart: 2,
      selectionEnd: 12,
    });
  });
});
