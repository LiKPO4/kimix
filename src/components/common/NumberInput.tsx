import { useEffect, useRef, useState, type FocusEvent, type InputHTMLAttributes, type KeyboardEvent } from "react";

type NumberInputProps = {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "onChange">;

function parseIntegerDraft(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 数字输入框（草稿语义）：聚焦期间以本地草稿为准，数值落在 [min, max] 内才实时
 * 提交；越界/空草稿不打断输入，失焦（或 Enter）时钳制提交、非法草稿回退到原值。
 * 解决「受控值 + 逐键 clamp」吞中间态的问题（如范围 [11,20] 想输 15，第一个
 * 字符「1」先被压成 11，再补一位又顶到 20，永远输不进目标值）。
 */
export function NumberInput({ value, min, max, onCommit, onFocus, onBlur, onKeyDown, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const focusedRef = useRef(false);

  // 非聚焦时跟随外部值（store 被其他入口改写时同步显示）；聚焦期间草稿优先，
  // 实时提交引起的外部值回跳不得覆盖用户正在输入的中间态。
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    focusedRef.current = true;
    onFocus?.(event);
  };
  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focusedRef.current = false;
    const parsed = parseIntegerDraft(event.target.value);
    if (parsed === undefined) {
      setDraft(String(value));
    } else {
      const clamped = Math.max(min, Math.min(max, Math.round(parsed)));
      setDraft(String(clamped));
      if (clamped !== value) onCommit(clamped);
    }
    onBlur?.(event);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    onKeyDown?.(event);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = parseIntegerDraft(text);
        if (parsed !== undefined && parsed >= min && parsed <= max) onCommit(parsed);
      }}
    />
  );
}
