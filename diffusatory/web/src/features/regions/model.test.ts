import { describe, expect, it } from "vitest";

import {
  addColumn,
  addRow,
  createRegionalComposition,
  cumulativeTracks,
  frameToLocal,
  localToFrame,
  moveBoundary,
  resolveSpatialPlan,
  updateCellPrompt,
} from "./model";

describe("regional composition geometry", () => {
  it("moves one boundary without disturbing its neighbours", () => {
    expect(moveBoundary([0.25, 0.5, 0.25], 1, 0.4)).toEqual([
      0.4, 0.35, 0.25,
    ]);
    expect(cumulativeTracks(moveBoundary([0.5, 0.5], 1, 0.99))).toEqual([
      0,
      0.92,
      1,
    ]);
  });

  it("splits the widest track and preserves existing prompt ownership", () => {
    let composition = updateCellPrompt(
      createRegionalComposition(),
      0,
      0,
      "the courier",
    );
    composition = addColumn(composition);
    composition = addRow(composition);
    expect(composition.columns).toEqual([0.5, 0.5]);
    expect(composition.rows).toEqual([0.5, 0.5]);
    expect(composition.cellPrompts).toEqual([
      ["the courier", ""],
      ["", ""],
    ]);
  });

  it("round trips transformed frame coordinates", () => {
    const composition = createRegionalComposition();
    composition.transform = {
      centerX: 0.42,
      centerY: 0.58,
      width: 0.6,
      height: 0.4,
      rotation: 31,
    };
    const frame = localToFrame(0.2, 0.8, composition.transform, 1216, 832);
    const local = frameToLocal(frame, composition.transform, 1216, 832);
    expect(local.x).toBeCloseTo(0.2);
    expect(local.y).toBeCloseTo(0.8);
  });

  it("resolves row-major cells and an explicit complement", () => {
    let composition = addColumn(addRow(createRegionalComposition()));
    composition = updateCellPrompt(composition, 0, 0, "foreground left");
    composition = {
      ...composition,
      softness: 0.05,
      backgroundEnabled: true,
      backgroundPrompt: "distant city",
    };
    const plan = resolveSpatialPlan(composition, 1000, 800);
    expect(plan.cells.map((cell) => cell.id)).toEqual([
      "r1c1",
      "r1c2",
      "r2c1",
      "r2c2",
    ]);
    expect(plan.cells[0].prompt).toBe("foreground left");
    expect(plan.softnessPixels).toBe(40);
    expect(plan.background).toEqual({ enabled: true, prompt: "distant city" });
  });
});
