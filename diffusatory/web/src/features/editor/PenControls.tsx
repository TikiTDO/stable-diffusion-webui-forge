import type { Dispatch, SetStateAction } from "react";

import type {
  BindingBehavior,
  TabletAction,
  TabletProfile,
} from "../../input/bindings";
import type { PressureCalibration } from "../../input/calibration";
import {
  BINDABLE_ACTIONS,
  signatureLabel,
  type PendingBinding,
} from "./tabletProfile";

export interface BindingRecording {
  action: TabletAction;
  behavior: BindingBehavior;
}

interface PenControlsProps {
  profile: TabletProfile;
  setProfile: Dispatch<SetStateAction<TabletProfile>>;
  recording: BindingRecording | null;
  setRecording: (recording: BindingRecording | null) => void;
  pendingBinding: PendingBinding | null;
  setPendingBinding: (binding: PendingBinding | null) => void;
  commitBinding: (binding: PendingBinding) => void;
  calibrationTarget: "light" | "firm" | null;
  setCalibrationTarget: (target: "light" | "firm" | null) => void;
  updatePressure: (patch: Partial<PressureCalibration>) => void;
}

export function PenControls({
  profile,
  setProfile,
  recording,
  setRecording,
  pendingBinding,
  setPendingBinding,
  commitBinding,
  calibrationTarget,
  setCalibrationTarget,
  updatePressure,
}: PenControlsProps) {
  return (
    <details className="pen-controls">
      <summary>Pen controls · {profile.name}</summary>
      <div className="pen-controls__body">
        <label>
          <span>Profile</span>
          <input
            value={profile.name}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
        </label>
        {BINDABLE_ACTIONS.map((item) => {
          const binding = profile.bindings.find(
            (candidate) => candidate.action === item.action,
          );
          return (
            <div className="binding-row" key={item.action}>
              <span>{item.label}</span>
              <small>
                {binding ? signatureLabel(binding.signature) : "Not bound"}
              </small>
              <button
                type="button"
                className={
                  recording?.action === item.action ? "is-recording" : ""
                }
                onClick={() => {
                  setPendingBinding(null);
                  setRecording({
                    action: item.action,
                    behavior: item.behavior,
                  });
                }}
              >
                {recording?.action === item.action
                  ? "Press pen control…"
                  : "Bind"}
              </button>
              {binding && (
                <button
                  type="button"
                  onClick={() =>
                    setProfile((current) => ({
                      ...current,
                      bindings: current.bindings.filter(
                        (candidate) => candidate.action !== item.action,
                      ),
                    }))
                  }
                >
                  Clear
                </button>
              )}
            </div>
          );
        })}
        {recording && (
          <button type="button" onClick={() => setRecording(null)}>
            Cancel binding
          </button>
        )}
        {pendingBinding?.conflict && (
          <div className="binding-conflict" role="alert">
            <span>
              {signatureLabel(pendingBinding.signature)} already controls{" "}
              {pendingBinding.conflict.action}.
            </span>
            <button
              type="button"
              onClick={() => commitBinding(pendingBinding)}
            >
              Replace that binding
            </button>
          </div>
        )}
        <div className="pressure-calibration">
          <div>
            <strong>Pressure</strong>
            <small>
              light {profile.pressure.inputMinimum.toFixed(2)} · firm{" "}
              {profile.pressure.inputMaximum.toFixed(2)}
            </small>
          </div>
          <button
            type="button"
            className={calibrationTarget === "light" ? "is-recording" : ""}
            onClick={() => setCalibrationTarget("light")}
          >
            {calibrationTarget === "light"
              ? "Draw lightly…"
              : "Capture light"}
          </button>
          <button
            type="button"
            className={calibrationTarget === "firm" ? "is-recording" : ""}
            onClick={() => setCalibrationTarget("firm")}
          >
            {calibrationTarget === "firm"
              ? "Draw firmly…"
              : "Capture firm"}
          </button>
          <label>
            <span>Curve {profile.pressure.curve.toFixed(2)}</span>
            <input
              type="range"
              min="0.25"
              max="2.5"
              step="0.05"
              value={profile.pressure.curve}
              onChange={(event) =>
                updatePressure({ curve: event.target.valueAsNumber })
              }
            />
          </label>
          <label>
            <span>
              Light floor{" "}
              {Math.round(profile.pressure.outputMinimum * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="0.4"
              step="0.01"
              value={profile.pressure.outputMinimum}
              onChange={(event) =>
                updatePressure({
                  outputMinimum: event.target.valueAsNumber,
                })
              }
            />
          </label>
        </div>
        <p>
          Left hand: Q/W choose paint or mask; A/S/D/F choose brush, erase,
          dropper, or pan; C/V resize; Z undoes; hold Space to pan. Prompt
          fields keep ordinary typing.
        </p>
      </div>
    </details>
  );
}
