// steer 内容滞留官方队列时的单条取消事件（官方 0.42 kap-server 恢复 per-prompt :abort）。
export const STEER_OFFICIAL_QUEUE_CANCEL_EVENT = "kimix:steer-official-queue-cancel";

export type SteerOfficialQueueCancelDetail = {
  sessionId: string;
  steerId: string;
};
