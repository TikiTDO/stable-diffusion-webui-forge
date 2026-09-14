import { describe, expect, it } from "vitest";

import { imageDownloadName, imageExtension } from "./imageDownload";

describe("image downloads", () => {
  it("keeps the image format represented by a data URL", () => {
    expect(imageExtension("data:image/png;base64,pixels")).toBe("png");
    expect(imageExtension("data:image/jpeg;base64,pixels")).toBe("jpg");
    expect(imageExtension("data:image/webp;base64,pixels")).toBe("webp");
  });

  it("creates a readable stable filename", () => {
    expect(
      imageDownloadName(
        "Working edit 2",
        "data:image/png;base64,pixels",
        new Date(2026, 8, 14, 9, 7, 5),
      ),
    ).toBe("diffusatory-working-edit-2-20260914-090705.png");
  });
});
