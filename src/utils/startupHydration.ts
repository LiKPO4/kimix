export interface StartupHydrationGate {
  wait: () => Promise<void>;
  markReady: () => void;
}

export function createStartupHydrationGate(): StartupHydrationGate {
  let ready = false;
  let resolveReady: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  return {
    wait: () => promise,
    markReady: () => {
      if (ready) return;
      ready = true;
      resolveReady?.();
    },
  };
}
