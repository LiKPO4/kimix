import { useRef } from "react";
import { usePresence } from "@/hooks/usePresence";

interface ToastSystemProps {
  message: string | null;
}

export function ToastSystem({ message }: ToastSystemProps) {
  const presence = usePresence(Boolean(message));
  const retainedMessage = useRef(message);
  if (message) retainedMessage.current = message;
  if (!presence.mounted || !retainedMessage.current) return null;

  return (
    <div
      className={`kimix-toast fixed left-1/2 top-16 z-[120] rounded-full bg-surface-elevated text-[14px] font-medium leading-5 text-text-primary ${presence.visible ? "is-visible" : ""}`}
      style={{ padding: "9px 18px" }}
    >
      {retainedMessage.current}
    </div>
  );
}
