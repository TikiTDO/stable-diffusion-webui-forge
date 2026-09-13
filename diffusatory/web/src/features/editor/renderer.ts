import { calibratePressure } from "../../input/calibration";
import type { PointerSample } from "../../input/pointer";
import type { StrokeOperation } from "./model";

function samplePressure(
  sample: PointerSample,
  operation: StrokeOperation,
): number {
  return sample.kind === "pen"
    ? calibratePressure(sample.pressure, operation.pressure)
    : 1;
}

function paintDot(
  context: CanvasRenderingContext2D,
  sample: PointerSample,
  operation: StrokeOperation,
) {
  const pressure = samplePressure(sample, operation);
  context.globalAlpha = operation.opacity * pressure;
  context.beginPath();
  context.arc(
    sample.imageX,
    sample.imageY,
    Math.max(0.5, (operation.size * pressure) / 2),
    0,
    Math.PI * 2,
  );
  context.fill();
}

export function paintStrokeSamples(
  context: CanvasRenderingContext2D,
  operation: StrokeOperation,
  fromSample = 0,
): void {
  if (!operation.samples.length) return;

  context.save();
  context.fillStyle = operation.layer === "mask" ? "#ffffff" : operation.color;
  context.strokeStyle = operation.layer === "mask" ? "#ffffff" : operation.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalCompositeOperation = operation.erase
    ? "destination-out"
    : "source-over";

  const start = Math.max(0, fromSample);
  if (start === 0) {
    paintDot(context, operation.samples[0], operation);
  }

  for (let index = Math.max(1, start); index < operation.samples.length; index += 1) {
    const previous = operation.samples[index - 1];
    const current = operation.samples[index];
    const pressure =
      (samplePressure(previous, operation) +
        samplePressure(current, operation)) /
      2;
    context.globalAlpha = operation.opacity * pressure;
    context.lineWidth = Math.max(1, operation.size * pressure);
    context.beginPath();
    context.moveTo(previous.imageX, previous.imageY);
    context.lineTo(current.imageX, current.imageY);
    context.stroke();
  }
  context.restore();
}

export function replayLayer(
  canvas: HTMLCanvasElement,
  operations: StrokeOperation[],
): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const operation of operations) {
    paintStrokeSamples(context, operation);
  }
}
