export interface RendererLoadSubscription {
  add(listener: () => void): void;
  remove(listener: () => void): void;
}

export type StartupBootstrapErrorStage = "resolve-project" | "remember-project";

export function createDeferredOnceTask(
  task: () => void | Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let scheduled = false;

  return () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      try {
        await task();
      } catch (error) {
        onError(error);
      }
    });
  };
}

export function createDistinctAsyncWriter<Value>(
  keyOf: (value: Value) => string,
  write: (value: Value) => Promise<void>,
): (value: Value) => Promise<void> {
  let successfulKey: string | null = null;
  const inFlightWrites = new Map<string, Promise<void>>();

  return (value) => {
    const key = keyOf(value);
    if (key === successfulKey) return Promise.resolve();

    const existingWrite = inFlightWrites.get(key);
    if (existingWrite) return existingWrite;

    const pendingWrite = Promise.resolve()
      .then(() => write(value))
      .then(() => {
        successfulKey = key;
      })
      .finally(() => {
        if (inFlightWrites.get(key) === pendingWrite) {
          inFlightWrites.delete(key);
        }
      });
    inFlightWrites.set(key, pendingWrite);
    return pendingWrite;
  };
}

export function registerStartupBootstrapPublisher(
  subscription: RendererLoadSubscription,
  publish: () => void,
): () => void {
  const handleDidFinishLoad = () => publish();
  subscription.add(handleDidFinishLoad);
  return () => subscription.remove(handleDidFinishLoad);
}

export async function publishStartupBootstrap<Project>(options: {
  resolveProject: () => Project;
  fallbackProject: () => Project;
  rememberProject: (project: Project) => Promise<void>;
  send: (payload: { project: Project }) => void;
  onError: (stage: StartupBootstrapErrorStage, error: unknown) => void;
}): Promise<Project> {
  let project: Project;
  try {
    project = options.resolveProject();
  } catch (error) {
    options.onError("resolve-project", error);
    project = options.fallbackProject();
  }

  // Bootstrap is a renderer recovery handshake. Persisting the recent-project
  // catalog is secondary and must never keep a reloaded document uninitialized.
  options.send({ project });

  try {
    await options.rememberProject(project);
  } catch (error) {
    options.onError("remember-project", error);
  }

  return project;
}
