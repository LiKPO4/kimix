interface ToastSystemProps {
  message: string | null;
}

export function ToastSystem({ message }: ToastSystemProps) {
  if (!message) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-16 z-[120] -translate-x-1/2 rounded-full border border-border-subtle bg-surface-elevated text-[14px] font-medium leading-5 text-text-primary shadow-floating-token"
      style={{ padding: "9px 18px" }}
    >
      {message}
    </div>
  );
}
