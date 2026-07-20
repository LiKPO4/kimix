import { isPerfDiagEnabled } from "@/utils/perfFlags";

export type ScrollTopWriteSource =
  | "anchor-restore"
  | "auto-follow"
  | "resize"
  | "bottom-preserve"
  | "settle-raf"
  | "other";

const scrollTopWrites: Record<ScrollTopWriteSource, number> = {
  "anchor-restore": 0,
  "auto-follow": 0,
  resize: 0,
  "bottom-preserve": 0,
  "settle-raf": 0,
  other: 0,
};

let renderTurnBodyRuns = 0;
let renderTurnBodyCacheHits = 0;

export function noteScrollTopWrite(source: ScrollTopWriteSource) {
  if (!isPerfDiagEnabled()) return;
  scrollTopWrites[source] += 1;
}

export function noteRenderTurnBodyRun(hitCache: boolean) {
  if (!isPerfDiagEnabled()) return;
  renderTurnBodyRuns += 1;
  if (hitCache) renderTurnBodyCacheHits += 1;
}

export function getPerfDiagSnapshot() {
  return {
    scrollTopWrites: { ...scrollTopWrites },
    renderTurnBodyRuns,
    renderTurnBodyCacheHits,
  };
}

export function resetPerfDiagForTests() {
  for (const key of Object.keys(scrollTopWrites) as ScrollTopWriteSource[]) {
    scrollTopWrites[key] = 0;
  }
  renderTurnBodyRuns = 0;
  renderTurnBodyCacheHits = 0;
}
