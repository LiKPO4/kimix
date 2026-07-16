export type ViewportAnchor = { key: string; offsetTop: number };
export type ResizeViewportAnchor = ViewportAnchor & { userScrollGeneration: number };
export type ProcessCollapseViewportSnapshot = {
  anchorElement: HTMLElement | null;
  anchorViewportTop?: number;
  scrollTop: number;
  autoFollow: boolean;
  userScroll: boolean;
};
