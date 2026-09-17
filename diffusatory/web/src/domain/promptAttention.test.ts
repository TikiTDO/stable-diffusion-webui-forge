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

  it("adjusts weight repeatedly without nesting parentheses", () => {
    const step1 = adjustPromptAttention("thing", 2, 2, 1);
    expect(step1).toEqual({
      text: "(thing:1.1)",
      selectionStart: 1,
      selectionEnd: 6,
    });

    const step2 = adjustPromptAttention(step1!.text, step1!.selectionStart, step1!.selectionEnd, 1);
    expect(step2).toEqual({
      text: "(thing:1.2)",
      selectionStart: 1,
      selectionEnd: 6,
    });

    const step3 = adjustPromptAttention(step2!.text, step2!.selectionStart, step2!.selectionEnd, -1);
    expect(step3).toEqual({
      text: "(thing:1.1)",
      selectionStart: 1,
      selectionEnd: 6,
    });

    const step4 = adjustPromptAttention(step3!.text, step3!.selectionStart, step3!.selectionEnd, -1);
    expect(step4).toEqual({
      text: "thing",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it("adjusts weight when the entire enclosing block is selected", () => {
    const step1 = adjustPromptAttention("(thing:1.1)", 0, 11, 1);
    expect(step1).toEqual({
      text: "(thing:1.2)",
      selectionStart: 1,
      selectionEnd: 6,
    });
  });
});
