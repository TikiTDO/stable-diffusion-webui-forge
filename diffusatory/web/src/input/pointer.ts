export type PointerKind = "pen" | "touch" | "mouse";

export type PointerPhase = "hover" | "down" | "move" | "up" | "cancel";

export interface ImagePoint {
  x: number;
  y: number;
}

export type ClientToImage = (clientX: number, clientY: number) => ImagePoint;

export interface PointerEventLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist?: number;
  tangentialPressure?: number;
  button: number;
  buttons: number;
  timeStamp: number;
  isPrimary?: boolean;
  getCoalescedEvents?: () => PointerEventLike[];
}

export interface PointerSample {
  pointerId: number;
  kind: PointerKind;
  phase: PointerPhase;
  imageX: number;
  imageY: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number | null;
  tangentialPressure: number | null;
  button: number;
  buttons: number;
  timestamp: number;
}

function pointerKind(pointerType: string): PointerKind {
  if (pointerType === "pen" || pointerType === "touch") return pointerType;
  return "mouse";
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizePointerSample(
  event: PointerEventLike,
  phase: PointerPhase,
  clientToImage: ClientToImage,
): PointerSample {
  const point = clientToImage(event.clientX, event.clientY);

  return {
    pointerId: event.pointerId,
    kind: pointerKind(event.pointerType),
    phase,
    imageX: finiteOr(point.x, 0),
    imageY: finiteOr(point.y, 0),
    pressure: bounded(finiteOr(event.pressure, 0), 0, 1),
    tiltX: bounded(finiteOr(event.tiltX, 0), -90, 90),
    tiltY: bounded(finiteOr(event.tiltY, 0), -90, 90),
    twist:
      event.twist === undefined
        ? null
        : bounded(finiteOr(event.twist, 0), 0, 359),
    tangentialPressure:
      event.tangentialPressure === undefined
        ? null
        : bounded(finiteOr(event.tangentialPressure, 0), -1, 1),
    button: event.button,
    buttons: event.buttons,
    timestamp: finiteOr(event.timeStamp, 0),
  };
}

/**
 * Return the real samples represented by one browser event.
 *
 * Browsers which expose coalesced pen motion have already grouped the higher
 * frequency samples into the dispatched pointermove. The dispatched event is
 * only used as a fallback; adding it to a non-empty coalesced list can draw the
 * last segment twice on implementations which include the current sample.
 */
export function pointerSamples(
  event: PointerEventLike,
  phase: PointerPhase,
  clientToImage: ClientToImage,
): PointerSample[] {
  const coalesced =
    phase === "move" ? (event.getCoalescedEvents?.() ?? []) : [];
  const events = coalesced.length > 0 ? coalesced : [event];

  return events.map((sample) =>
    normalizePointerSample(sample, phase, clientToImage),
  );
}

