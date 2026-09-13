import { describe, expect, it } from "vitest";

import type { ControlNetCatalog } from "../../api/forge/types";
import {
  conditionForIntent,
  conditionIssue,
  createCondition,
  orderedIntents,
  resolveConditions,
} from "./model";

const catalog: ControlNetCatalog = {
  types: {
    All: {
      modules: ["None"],
      models: ["None"],
      defaultModule: "None",
      defaultModel: "None",
    },
    OpenPose: {
      modules: ["openpose_full", "openpose_hand"],
      models: ["pose-xl"],
      defaultModule: "openpose_full",
      defaultModel: "pose-xl",
    },
    Depth: {
      modules: ["depth_midas"],
      models: ["depth-xl"],
      defaultModule: "depth_midas",
      defaultModel: "depth-xl",
    },
  },
};

describe("ControlNet condition model", () => {
  it("puts common intents first and creates a useful depth card", () => {
    expect(orderedIntents(catalog)).toEqual(["Depth", "OpenPose"]);
    expect(createCondition(catalog, "one")).toMatchObject({
      id: "one",
      intent: "Depth",
      module: "depth_midas",
      model: "depth-xl",
      source: { kind: "independent", image: null },
    });
  });

  it("changes intent as one coherent choice", () => {
    const changed = conditionForIntent(
      { ...createCondition(catalog, "one"), preview: "old" },
      "OpenPose",
      catalog,
    );
    expect(changed).toMatchObject({
      intent: "OpenPose",
      module: "openpose_full",
      model: "pose-xl",
      preview: null,
    });
  });

  it("blocks an enabled incomplete source but ignores disabled cards", () => {
    const condition = createCondition(catalog, "one");
    expect(conditionIssue(condition, null)).toBe("Choose a conditioning image.");
    expect(conditionIssue({ ...condition, enabled: false }, null)).toBeNull();
  });

  it("resolves current and independent sources at the generation boundary", () => {
    const current = {
      ...createCondition(catalog, "current"),
      source: { kind: "current" as const },
    };
    const independent = {
      ...conditionForIntent(createCondition(catalog, "other"), "OpenPose", catalog),
      source: {
        kind: "independent" as const,
        image: "data:image/png;base64,pose",
        name: "pose.png",
      },
    };

    expect(
      resolveConditions([current, independent], "data:image/png;base64,canvas"),
    ).toMatchObject([
      { module: "depth_midas", image: "data:image/png;base64,canvas" },
      { module: "openpose_full", image: "data:image/png;base64,pose" },
    ]);
  });
});
