export interface OfficialPromptQueueState {
  supported: boolean;
  activeId: string | null;
  activeStatus: string | null;
  queuedIds: string[];
}

export function shouldDeferLocalPendingDispatch(state: OfficialPromptQueueState | null | undefined) {
  return Boolean(state?.supported && (state.activeId || state.queuedIds.length > 0));
}
