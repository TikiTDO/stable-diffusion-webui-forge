import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";

interface NumberInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "onBlur"
  > {
  value: number;
  onValueChange: (value: number) => void;
  clamp?: (value: number) => number;
}

/** A controlled number field that still permits human intermediate text.

    In particular, clearing "20" before entering "4" must not immediately
    repaint the old 20. Valid numbers are published as they are typed; an
    unfinished or invalid value rolls back only when focus leaves the field.
 */
export function NumberInput({
  value,
  onValueChange,
  clamp = (candidate) => candidate,
  onFocus,
  ...props
}: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (candidate: string): boolean => {
    if (!candidate.trim()) return false;
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed)) return false;
    onValueChange(clamp(parsed));
    return true;
  };

  return (
    <input
      {...props}
      type="number"
      value={text}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onChange={(event) => {
        setText(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (!commit(text)) setText(String(value));
      }}
    />
  );
}
