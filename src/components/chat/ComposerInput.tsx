import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

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
  onKeyDownCapture?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

const MAX_HEIGHT = 132;
const MIN_HEIGHT = 52;
const SCROLLBAR_TRACK_VERTICAL_INSET = 9;
const SCROLLBAR_THUMB_MIN_HEIGHT = 28;

function resizeComposerTextarea(element: HTMLTextAreaElement): number {
  element.style.height = "auto";
  const height = Math.max(MIN_HEIGHT, Math.min(element.scrollHeight, MAX_HEIGHT));
  element.style.height = `${height}px`;
  return height;
}

interface ComposerScrollbarMetrics {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
}

export function calculateComposerScrollbarMetrics({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): ComposerScrollbarMetrics {
  const trackHeight = Math.max(0, clientHeight - SCROLLBAR_TRACK_VERTICAL_INSET);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (trackHeight === 0 || maxScrollTop <= 1) {
    return { visible: false, thumbHeight: 0, thumbTop: 0 };
  }

  const thumbHeight = Math.min(
    trackHeight,
    Math.max(SCROLLBAR_THUMB_MIN_HEIGHT, Math.round(trackHeight * (clientHeight / scrollHeight))),
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxThumbTop * (Math.min(maxScrollTop, Math.max(0, scrollTop)) / maxScrollTop);

  return { visible: true, thumbHeight, thumbTop };
}

export const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput(
    { value, placeholder, disabled, onChange, onSubmit, onFocus, onBlur, onPaste, onKeyDownCapture },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollbarTrackRef = useRef<HTMLDivElement>(null);
    const scrollbarDragOffsetRef = useRef<number | null>(null);
    const [scrollbarMetrics, setScrollbarMetrics] = useState<ComposerScrollbarMetrics>({
      visible: false,
      thumbHeight: 0,
      thumbTop: 0,
    });

    const updateScrollbar = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      setScrollbarMetrics(calculateComposerScrollbarMetrics(el));
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      reset: () => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          requestAnimationFrame(updateScrollbar);
        }
      },
    }), [updateScrollbar]);

    const autoResize = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return null;
      resizeComposerTextarea(el);
      return requestAnimationFrame(updateScrollbar);
    }, [updateScrollbar]);

    useLayoutEffect(() => {
      const frame = autoResize();
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
      };
    }, [autoResize, value]);

    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(updateScrollbar);
      observer.observe(el);
      return () => observer.disconnect();
    }, [updateScrollbar]);

    const scrollToThumbTop = (thumbTop: number) => {
      const el = textareaRef.current;
      const track = scrollbarTrackRef.current;
      if (!el || !track) return;
      const maxThumbTop = Math.max(0, track.clientHeight - scrollbarMetrics.thumbHeight);
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const clampedThumbTop = Math.min(maxThumbTop, Math.max(0, thumbTop));
      el.scrollTop = maxThumbTop > 0 ? (clampedThumbTop / maxThumbTop) * maxScrollTop : 0;
      updateScrollbar();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDownCapture?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    };

    return (
      <div className="kimix-composer-input-wrap relative min-w-0 w-full">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onScroll={updateScrollbar}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          rows={1}
          style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, overflowWrap: "anywhere", wordBreak: "break-word", paddingTop: 3, paddingBottom: 6 }}
          className="kimix-composer-input no-focus-outline block w-full resize-none whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-[14.5px] leading-[21px] text-text-primary placeholder:text-text-muted shadow-none outline-none ring-0 caret-accent-primary focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed"
        />
        {scrollbarMetrics.visible && (
          <div
            ref={scrollbarTrackRef}
            className="kimix-composer-input-scrollbar"
            style={{ position: "absolute", top: 3, right: -11, bottom: 6 }}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const trackBounds = event.currentTarget.getBoundingClientRect();
              scrollToThumbTop(event.clientY - trackBounds.top - scrollbarMetrics.thumbHeight / 2);
            }}
            aria-hidden="true"
          >
            <div
              className="kimix-composer-input-scrollbar-thumb"
              style={{ top: scrollbarMetrics.thumbTop, height: scrollbarMetrics.thumbHeight }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                scrollbarDragOffsetRef.current = event.clientY - event.currentTarget.getBoundingClientRect().top;
              }}
              onPointerMove={(event) => {
                if (scrollbarDragOffsetRef.current === null) return;
                const trackBounds = scrollbarTrackRef.current?.getBoundingClientRect();
                if (!trackBounds) return;
                scrollToThumbTop(event.clientY - trackBounds.top - scrollbarDragOffsetRef.current);
              }}
              onPointerUp={(event) => {
                scrollbarDragOffsetRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                scrollbarDragOffsetRef.current = null;
              }}
            />
          </div>
        )}
      </div>
    );
  },
);
