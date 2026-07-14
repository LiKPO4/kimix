export function createReplayLatestChannel<T>() {
  let hasLatestValue = false;
  let latestValue: T;
  const listeners = new Set<(value: T) => void>();

  return {
    publish(value: T) {
      hasLatestValue = true;
      latestValue = value;
      for (const listener of listeners) listener(value);
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      if (hasLatestValue) listener(latestValue);
      return () => { listeners.delete(listener); };
    },
  };
}
