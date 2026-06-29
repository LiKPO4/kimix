import { useEffect, useState } from "react";

export function usePresence(present: boolean, exitDurationMs = 150) {
  const [mounted, setMounted] = useState(present);
  const [visible, setVisible] = useState(present);

  useEffect(() => {
    let frame = 0;
    let timer = 0;

    if (present) {
      setMounted(true);
      frame = window.requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), exitDurationMs);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [exitDurationMs, present]);

  return { mounted, visible };
}
