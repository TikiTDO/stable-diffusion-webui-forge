export interface PressureCalibration {
  /** Raw pressure observed for a deliberately light stroke. */
  inputMinimum: number;
  /** Raw pressure observed for a deliberately firm stroke. */
  inputMaximum: number;
  /** Output retained even at the light end, in the range 0..1. */
  outputMinimum: number;
  /** Maximum pressure supplied to the brush, in the range 0..1. */
  outputMaximum: number;
  /** Exponent applied to the normalized input. 1 is linear. */
  curve: number;
}

export const DEFAULT_PRESSURE_CALIBRATION: PressureCalibration = {
  inputMinimum: 0.02,
  inputMaximum: 0.85,
  outputMinimum: 0.08,
  outputMaximum: 1,
  curve: 1,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calibratePressure(
  rawPressure: number,
  calibration: PressureCalibration,
): number {
  const inputMinimum = clamp(calibration.inputMinimum, 0, 0.999);
  const inputMaximum = clamp(calibration.inputMaximum, inputMinimum + 0.001, 1);
  const outputMinimum = clamp(calibration.outputMinimum, 0, 1);
  const outputMaximum = clamp(
    calibration.outputMaximum,
    outputMinimum,
    1,
  );
  const curve = Number.isFinite(calibration.curve)
    ? clamp(calibration.curve, 0.1, 5)
    : 1;
  const raw = Number.isFinite(rawPressure) ? rawPressure : 0;
  const normalized = clamp(
    (raw - inputMinimum) / (inputMaximum - inputMinimum),
    0,
    1,
  );
  const curved = normalized ** curve;

  return outputMinimum + curved * (outputMaximum - outputMinimum);
}

export function representativePressure(readings: number[]): number | null {
  const usable = readings
    .filter((reading) => Number.isFinite(reading) && reading > 0)
    .map((reading) => clamp(reading, 0, 1))
    .sort((left, right) => left - right);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[middle]
    : (usable[middle - 1] + usable[middle]) / 2;
}
