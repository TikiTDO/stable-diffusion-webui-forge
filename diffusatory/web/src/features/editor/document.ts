import type { PointerSample } from "../../input/pointer";
import type { EditorLayer, StrokeOperation } from "./model";
import { paintStrokeSamples, replayLayer } from "./renderer";

export interface EditorExport {
  initImage: string;
  mask: string | null;
  width: number;
  height: number;
}

export interface EditorViewport {
  scale: number;
  x: number;
  y: number;
  zoom: number;
}

export function createLayerCanvas(
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function imageFromSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The source image could not be decoded."));
    image.src = source;
  });
}

/**
 * The editable image is a document, not React state. React owns controls while
 * this object owns full-resolution pixels and the replayable operation log.
 */
export class EditorDocument {
  readonly width: number;
  readonly height: number;
  readonly source: HTMLCanvasElement;
  readonly paint: HTMLCanvasElement;
  readonly mask: HTMLCanvasElement;
  readonly maskTint: HTMLCanvasElement;

  private operations: StrokeOperation[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.source = createLayerCanvas(width, height);
    this.paint = createLayerCanvas(width, height);
    this.mask = createLayerCanvas(width, height);
    this.maskTint = createLayerCanvas(width, height);

    const context = this.source.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }

  async loadSource(source: string | null, maskSource: string | null = null): Promise<void> {
    const image = source ? await imageFromSource(source) : null;
    const context = this.source.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    if (image) {
      context.clearRect(0, 0, this.width, this.height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, this.width, this.height);
      context.drawImage(image, 0, 0, this.width, this.height);
    }
    if (maskSource) await this.loadMask(maskSource);
  }

  layer(name: EditorLayer): HTMLCanvasElement {
    return name === "paint" ? this.paint : this.mask;
  }

  renderStroke(
    operation: StrokeOperation,
    fromSample: number,
  ): void {
    const context = this.layer(operation.layer).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return;
    paintStrokeSamples(context, operation, fromSample);
    if (operation.layer === "mask") this.refreshMaskTint();
  }

  commit(operation: StrokeOperation): void {
    if (operation.samples.length) this.operations.push(operation);
  }

  undo(): void {
    this.operations.pop();
    this.rebuild();
  }

  clear(layer: EditorLayer): void {
    this.operations = this.operations.filter(
      (operation) => operation.layer !== layer,
    );
    this.rebuild();
  }

  rebuild(): void {
    replayLayer(
      this.paint,
      this.operations.filter((operation) => operation.layer === "paint"),
    );
    replayLayer(
      this.mask,
      this.operations.filter((operation) => operation.layer === "mask"),
    );
    this.refreshMaskTint();
  }

  sampleColor(sample: PointerSample): string | null {
    const x = Math.floor(sample.imageX);
    const y = Math.floor(sample.imageY);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const composite = createLayerCanvas(this.width, this.height);
    const context = composite.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(this.source, 0, 0);
    context.drawImage(this.paint, 0, 0);
    const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  drawDisplay(
    context: CanvasRenderingContext2D,
    viewport: EditorViewport,
    displayWidth: number,
    displayHeight: number,
  ): { x: number; y: number; scale: number } {
    const fit = Math.min(
      displayWidth / this.width,
      displayHeight / this.height,
    );
    const scale = fit * viewport.zoom;
    const drawWidth = this.width * scale;
    const drawHeight = this.height * scale;
    const x = (displayWidth - drawWidth) / 2 + viewport.x;
    const y = (displayHeight - drawHeight) / 2 + viewport.y;
    viewport.scale = scale;

    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(this.source, x, y, drawWidth, drawHeight);
    context.drawImage(this.paint, x, y, drawWidth, drawHeight);
    context.globalAlpha = 0.47;
    context.drawImage(this.maskTint, x, y, drawWidth, drawHeight);
    context.restore();
    return { x, y, scale };
  }

  exportForGeneration(): EditorExport | null {
    const output = createLayerCanvas(this.width, this.height);
    const context = output.getContext("2d");
    if (!context) return null;
    context.drawImage(this.source, 0, 0);
    context.drawImage(this.paint, 0, 0);
    return {
      initImage: output.toDataURL("image/png"),
      mask: this.exportMask(),
      width: this.width,
      height: this.height,
    };
  }

  private refreshMaskTint(): void {
    const context = this.maskTint.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, this.maskTint.width, this.maskTint.height);
    context.drawImage(this.mask, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = "#cf5fe8";
    context.fillRect(0, 0, this.maskTint.width, this.maskTint.height);
    context.globalCompositeOperation = "source-over";
  }

  private async loadMask(source: string): Promise<void> {
    const image = await imageFromSource(source);
    const staging = createLayerCanvas(this.width, this.height);
    const stagingContext = staging.getContext("2d", { willReadFrequently: true });
    const maskContext = this.mask.getContext("2d");
    if (!stagingContext || !maskContext) {
      throw new Error("Canvas 2D is unavailable in this browser.");
    }
    stagingContext.drawImage(image, 0, 0, this.width, this.height);
    const pixels = stagingContext.getImageData(0, 0, this.width, this.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = Math.max(
        pixels.data[index],
        pixels.data[index + 1],
        pixels.data[index + 2],
      );
      pixels.data[index] = 255;
      pixels.data[index + 1] = 255;
      pixels.data[index + 2] = 255;
      pixels.data[index + 3] = Math.round(
        (luminance * pixels.data[index + 3]) / 255,
      );
    }
    maskContext.clearRect(0, 0, this.width, this.height);
    maskContext.putImageData(pixels, 0, 0);
    this.refreshMaskTint();
  }

  private exportMask(): string | null {
    const context = this.mask.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const pixels = context.getImageData(
      0,
      0,
      this.mask.width,
      this.mask.height,
    ).data;
    let hasContent = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) return null;

    const output = createLayerCanvas(this.width, this.height);
    const outputContext = output.getContext("2d");
    if (!outputContext) return null;
    outputContext.fillStyle = "#000000";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(this.mask, 0, 0);
    return output.toDataURL("image/png");
  }
}
