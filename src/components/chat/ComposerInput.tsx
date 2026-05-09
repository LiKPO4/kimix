import { forwardRef, useImperativeHandle, useRef } from "react";

export interface ComposerInputHandle {
  focus: () => void;
  reset: () => void;
}

interface ComposerInputProps {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

const MAX_HEIGHT = 132;
const MIN_HEIGHT = 21;

export const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput(
    { value, placeholder, disabled, onChange, onSubmit, onFocus, onBlur, onPaste },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      reset: () => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      },
    }));

    const autoResize = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    };

    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          autoResize();
        }}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onPaste={onPaste}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
        rows={1}
        style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, overflowWrap: "anywhere", wordBreak: "break-word" }}
        className="no-focus-outline block w-full resize-none whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-[14.5px] leading-[21px] text-[#27231f] placeholder:text-[#b8b2a8] shadow-none outline-none ring-0 caret-[#24211d] focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed"
      />
    );
  },
);
