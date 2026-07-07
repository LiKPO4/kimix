export interface OfficialPromptQueueState {
  supported: boolean;
  activeId: string | null;
  activeStatus: string | null;
  queuedIds: string[];
  queued?: Array<{ promptId: string; content: string; status: string; createdAt?: string }>;
}

export function shouldDeferLocalPendingDispatch(state: OfficialPromptQueueState | null | undefined) {
  return Boolean(state?.supported && (state.activeId || state.queuedIds.length > 0));
}
