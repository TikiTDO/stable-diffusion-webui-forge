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

export interface BrushFootprint {
  radiusX: number;
  radiusY: number;
  rotation: number;
}

export function brushFootprint(
  sample: PointerSample,
  operation: StrokeOperation,
): BrushFootprint {
  const pressure = samplePressure(sample, operation);
  const radius = Math.max(0.5, (operation.size * pressure) / 2);
  const altitudeTilt =
    sample.altitudeAngle === null
      ? null
      : 1 - sample.altitudeAngle / (Math.PI / 2);
  const legacyTilt = Math.min(1, Math.hypot(sample.tiltX, sample.tiltY) / 90);
  const tilt = Math.max(0, Math.min(1, altitudeTilt ?? legacyTilt));
  const rotation =
    sample.azimuthAngle ??
    (sample.twist !== null
      ? (sample.twist * Math.PI) / 180
      : Math.atan2(sample.tiltY, sample.tiltX));
  return {
    radiusX: radius,
    radiusY: Math.max(0.5, radius * (1 - tilt * 0.62)),
    rotation,
  };
}

function paintDot(
  context: CanvasRenderingContext2D,
  sample: PointerSample,
  operation: StrokeOperation,
) {
  const footprint = brushFootprint(sample, operation);
  // Pressure changes the physical footprint, not the pigment alpha. Ordinary
  // paint is a structural hint and inpaint masks must remain fully selected.
  context.globalAlpha = operation.opacity;
  context.beginPath();
  context.ellipse(
    sample.imageX,
    sample.imageY,
    footprint.radiusX,
    footprint.radiusY,
    footprint.rotation,
    0,
    Math.PI * 2,
  );
  context.fill();
}

function interpolateSample(
  previous: PointerSample,
  current: PointerSample,
  amount: number,
): PointerSample {
  const number = (left: number, right: number) => left + (right - left) * amount;
  const optional = (left: number | null, right: number | null) =>
    left === null || right === null ? (amount < 0.5 ? left : right) : number(left, right);
  return {
    ...current,
    imageX: number(previous.imageX, current.imageX),
    imageY: number(previous.imageY, current.imageY),
    pressure: number(previous.pressure, current.pressure),
    tiltX: number(previous.tiltX, current.tiltX),
    tiltY: number(previous.tiltY, current.tiltY),
    altitudeAngle: optional(previous.altitudeAngle, current.altitudeAngle),
    azimuthAngle: optional(previous.azimuthAngle, current.azimuthAngle),
    twist: optional(previous.twist, current.twist),
    tangentialPressure: optional(
      previous.tangentialPressure,
      current.tangentialPressure,
    ),
    timestamp: number(previous.timestamp, current.timestamp),
  };
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
    const length = Math.hypot(
      current.imageX - previous.imageX,
      current.imageY - previous.imageY,
    );
    const radius = Math.min(
      brushFootprint(previous, operation).radiusY,
      brushFootprint(current, operation).radiusY,
    );
    const steps = Math.max(1, Math.ceil(length / Math.max(1, radius * 0.65)));
    for (let step = 1; step <= steps; step += 1) {
      paintDot(context, interpolateSample(previous, current, step / steps), operation);
    }
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
