import type { LongTaskSessionMeta, Session } from "@/types/ui";

type LongTaskAgentRole = LongTaskSessionMeta["activeAgent"];

export function getRuntimeSessionId(session: Session | null | undefined): string | null {
  if (!session) return null;
  if (session.longTask) {
    return session.longTask.executorSessionId;
  }
  return session.runtimeSessionId ?? session.id;
}

export function getLongTaskRoleForRuntime(session: Session | null | undefined, runtimeSessionId: string): LongTaskAgentRole | null {
  if (!session?.longTask) return null;
  if (session.longTask.executorSessionId === runtimeSessionId) return "executor";
  if (session.longTask.reviewerSessionId === runtimeSessionId) return "reviewer";
  return null;
}
