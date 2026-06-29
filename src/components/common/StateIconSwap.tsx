import type { ReactNode } from "react";

interface StateIconSwapProps {
  active: boolean;
  activeIcon: ReactNode;
  inactiveIcon: ReactNode;
}

export function StateIconSwap({ active, activeIcon, inactiveIcon }: StateIconSwapProps) {
  return (
    <span className="kimix-state-icon-swap" aria-hidden="true">
      <span className={active ? "is-visible" : ""}>{activeIcon}</span>
      <span className={!active ? "is-visible" : ""}>{inactiveIcon}</span>
    </span>
  );
}
