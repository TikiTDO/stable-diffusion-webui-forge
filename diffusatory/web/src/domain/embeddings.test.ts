import { describe, expect, it } from "vitest";

import {
  indexEmbeddings,
  matchIndexedEmbedding,
  searchEmbeddings,
} from "./embeddings";
import { normalizedField } from "./loras";

const sampleEmbeddings = [
  "easynegative",
  "bad-hands-5",
  "badhandv4",
  "FastNegativeEmbedding",
  "style/oil_painting",
  "styles/watercolor_v2",
  "deep_negative",
  "verybadimagenegative_v1.3",
];

describe("Textual Inversion embeddings search", () => {
  const indexed = indexEmbeddings(sampleEmbeddings);

  it("returns all embeddings sorted alphabetically when query is empty", () => {
    const results = searchEmbeddings(indexed, "");
    expect(results).toHaveLength(sampleEmbeddings.length);
    expect(results[0]).toBe("bad-hands-5");
    expect(results).toEqual([...sampleEmbeddings].sort((a, b) => a.localeCompare(b)));
  });

  it("prioritizes prefix matches over substring matches", () => {
    const results = searchEmbeddings(indexed, "bad");
    expect(results).toContain("bad-hands-5");
    expect(results).toContain("badhandv4");
    expect(results).toContain("verybadimagenegative_v1.3");
    // "bad-hands-5" and "badhandv4" start with "bad", so they rank before "verybad..."
    expect(results.indexOf("bad-hands-5")).toBeLessThan(
      results.indexOf("verybadimagenegative_v1.3"),
    );
    expect(results.indexOf("badhandv4")).toBeLessThan(
      results.indexOf("verybadimagenegative_v1.3"),
    );
  });

  it("matches token boundaries across separators like slashes and underscores", () => {
    const results = searchEmbeddings(indexed, "oil");
    expect(results).toEqual(["style/oil_painting"]);

    const handsResults = searchEmbeddings(indexed, "hands");
    expect(handsResults).toContain("bad-hands-5");
  });

  it("performs fuzzy matching on 3+ characters and rejects weak noise", () => {
    const results = searchEmbeddings(indexed, "esyneg");
    expect(results).toContain("easynegative");

    const noMatches = searchEmbeddings(indexed, "xyz999");
    expect(noMatches).toHaveLength(0);
  });

  it("does not truncate results to an arbitrary cap", () => {
    const manyEmbeddings = Array.from({ length: 60 }, (_, i) => `negative_embed_${i.toString().padStart(2, "0")}`);
    const indexedMany = indexEmbeddings(manyEmbeddings);
    const results = searchEmbeddings(indexedMany, "negative");
    expect(results).toHaveLength(60);
  });
});
