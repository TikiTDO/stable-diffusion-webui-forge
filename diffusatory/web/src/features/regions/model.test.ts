import { describe, expect, it } from "vitest";

import {
  addColumn,
  addMovableRegion,
  addRow,
  createMovableRegion,
  createRegionalComposition,
  cumulativeTracks,
  frameToLocal,
  localToFrame,
  moveBoundary,
  regionPolygon,
  removeMovableRegion,
  resolveSpatialPlan,
  updateCellPrompt,
  updateMovableRegion,
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

  it("adds, updates, and removes movable regions", () => {
    let composition = createRegionalComposition();
    expect(composition.regions).toEqual([]);

    composition = addMovableRegion(composition, {
      id: "hero",
      name: "Hero Character",
      prompt: "young adventurer",
      transform: { centerX: 0.3, centerY: 0.5, width: 0.3, height: 0.4, rotation: 0 },
    });
    expect(composition.regions?.length).toBe(1);
    expect(composition.activeRegionId).toBe("hero");
    expect(composition.regions?.[0].prompt).toBe("young adventurer");

    composition = addMovableRegion(composition, {
      id: "companion",
      name: "Companion",
      prompt: "robotic owl",
    });
    expect(composition.regions?.length).toBe(2);
    expect(composition.activeRegionId).toBe("companion");

    composition = updateMovableRegion(composition, "hero", {
      prompt: "young adventurer in crimson coat",
    });
    expect(composition.regions?.[0].prompt).toBe("young adventurer in crimson coat");

    composition = removeMovableRegion(composition, "companion");
    expect(composition.regions?.length).toBe(1);
    expect(composition.activeRegionId).toBe("hero");
  });

  it("resolves movable regions into spatial plan with early-steps composition lock", () => {
    let composition = createRegionalComposition();
    composition = {
      ...composition,
      lockFraction: 0.3, // 30% early-steps composition lock
      backgroundEnabled: true,
      backgroundPrompt: "dramatic cyberpunk alleyway, wide angle shot",
    };
    composition = addMovableRegion(composition, {
      id: "character",
      prompt: "detective in trenchcoat",
      transform: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.6, rotation: 0 },
    });

    const plan = resolveSpatialPlan(composition, 1000, 1000);
    expect(plan.cells.length).toBe(1);
    expect(plan.cells[0].id).toBe("character");
    expect(plan.cells[0].prompt).toBe("detective in trenchcoat");
    // Early-steps composition lock sets foreground start to lockFraction (0.3)
    expect(plan.cells[0].start).toBe(0.3);
    expect(plan.cells[0].end).toBe(1.0);
    expect(plan.cells[0].polygon.length).toBe(4);
    // Center at (500, 500), width 400 (300 to 700), height 600 (200 to 800)
    expect(plan.cells[0].polygon[0].x).toBeCloseTo(300);
    expect(plan.cells[0].polygon[0].y).toBeCloseTo(200);
    expect(plan.cells[0].polygon[1].x).toBeCloseTo(700);
    expect(plan.cells[0].polygon[1].y).toBeCloseTo(200);
    expect(plan.cells[0].polygon[2].x).toBeCloseTo(700);
    expect(plan.cells[0].polygon[2].y).toBeCloseTo(800);
    expect(plan.cells[0].polygon[3].x).toBeCloseTo(300);
    expect(plan.cells[0].polygon[3].y).toBeCloseTo(800);
  });
});

