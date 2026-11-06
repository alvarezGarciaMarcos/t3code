export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 980px)";

export type ThreadPanelPresentation = "inline" | "popover";

export function rightPanelWidthStorageKey(threadKey: string): string {
  return `t3code:preview-panel-width:${threadKey}`;
}
