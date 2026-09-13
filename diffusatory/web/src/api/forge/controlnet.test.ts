import { describe, expect, it } from "vitest";

import { controlNetAlwaysOnScripts, controlNetUnitWire } from "./controlnet";

describe("ControlNet compatibility adapter", () => {
  it("does not register the always-on script without conditions", () => {
    expect(controlNetAlwaysOnScripts(undefined)).toEqual({});
    expect(controlNetAlwaysOnScripts([])).toEqual({});
  });

  it("owns the extension field names and defaults in one adapter", () => {
    expect(
      controlNetUnitWire({
        module: "depth_midas",
        model: "depth-xl",
        image: "data:image/png;base64,source",
        weight: 0.8,
        guidanceStart: 0.1,
        guidanceEnd: 0.75,
      }),
    ).toEqual({
      input_mode: "simple",
      use_preview_as_input: false,
      enabled: true,
      module: "depth_midas",
      model: "depth-xl",
      image: "data:image/png;base64,source",
      weight: 0.8,
      resize_mode: "Crop and Resize",
      processor_res: -1,
      threshold_a: -1,
      threshold_b: -1,
      guidance_start: 0.1,
      guidance_end: 0.75,
      pixel_perfect: true,
      control_mode: "Balanced",
      save_detected_map: true,
    });
  });
});
