import { useRef, useCallback } from "react";
import {
  requiredViewportTailCompensation,
} from "@/utils/chatViewportTransaction";

export interface UseViewportTailCompensationResult {
  /** Current detached-tail compensation value (px). Exposed so callers can read it directly. */
  detachedTailCompensationRef: React.MutableRefObject<number>;
  /** Read the current compensation value without accessing the ref from outside. */
  getDetachedTailCompensation: () => number;
  setDetachedTailCompensation: (value: number) => void;
  clearDetachedViewportCompensation: () => void;
  reconcileDetachedViewportCompensation: (node: HTMLElement) => void;
  naturalDistanceFromBottom: (node: HTMLElement) => number;
}

export function useViewportTailCompensation(
  streamContentRef: React.RefObject<HTMLDivElement | null>,
): UseViewportTailCompensationResult {
  const detachedViewportMinimumScrollHeightRef = useRef<number | null>(null);
  const detachedTailCompensationRef = useRef(0);

  const setDetachedTailCompensation = useCallback((value: number) => {
    const nextValue = Math.max(0, value);
    if (Math.abs(detachedTailCompensationRef.current - nextValue) <= 0.01) return;
    detachedTailCompensationRef.current = nextValue;
    streamContentRef.current?.style.setProperty(
      "--kimix-detached-tail-compensation",
      `${nextValue}px`,
    );
  }, [streamContentRef]);

  const clearDetachedViewportCompensation = useCallback(() => {
    detachedViewportMinimumScrollHeightRef.current = null;
    setDetachedTailCompensation(0);
  }, [setDetachedTailCompensation]);

  const reconcileDetachedViewportCompensation = useCallback((node: HTMLElement) => {
    const minimumScrollHeight = detachedViewportMinimumScrollHeightRef.current;
    if (minimumScrollHeight === null) return;
    const naturalScrollHeight = Math.max(0, node.scrollHeight - detachedTailCompensationRef.current);
    const nextCompensation = requiredViewportTailCompensation({
      minimumScrollHeight,
      naturalScrollHeight,
    });
    setDetachedTailCompensation(nextCompensation);
    if (nextCompensation <= 0.01) {
      detachedViewportMinimumScrollHeightRef.current = null;
    }
  }, [setDetachedTailCompensation]);

  const naturalDistanceFromBottom = useCallback((node: HTMLElement) => Math.max(
    0,
    node.scrollHeight - detachedTailCompensationRef.current - node.scrollTop - node.clientHeight,
  ), []);

  const getDetachedTailCompensation = useCallback(() => detachedTailCompensationRef.current, []);

  return {
    detachedTailCompensationRef,
    getDetachedTailCompensation,
    setDetachedTailCompensation,
    clearDetachedViewportCompensation,
    reconcileDetachedViewportCompensation,
    naturalDistanceFromBottom,
  };
}
