import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";

import { stackedThreadToast, toastManager } from "./components/ui/toast";
import { readLocalStorageValue } from "./hooks/useLocalStorage";
import { PREVIEW_PANEL_DEFAULT_WIDTH } from "./hooks/usePreviewPanelInlineSize";
import { randomUUID } from "./lib/utils";
import { capturePaneLayout, usePaneLayoutStore } from "./paneLayoutStore";
import { readThreadPreviewState } from "./previewStateStore";
import { rightPanelWidthStorageKey } from "./rightPanelLayout";
import {
  rightPanelHostRef,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

export function saveThreadPaneLayout(threadRef: ScopedThreadRef, name: string): void {
  const ref = rightPanelHostRef(threadRef);
  const layout = capturePaneLayout({
    id: randomUUID(),
    name,
    panel: selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref),
    previewSessions: readThreadPreviewState(ref).sessions,
    panelWidth: readLocalStorageValue(
      rightPanelWidthStorageKey(scopedThreadKey(ref)),
      PREVIEW_PANEL_DEFAULT_WIDTH,
      Schema.Finite,
    ),
    viewportWidth: window.innerWidth,
  });
  const { replaced } = usePaneLayoutStore.getState().saveLayout(layout);
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title: replaced ? `Updated layout "${layout.name}"` : `Saved layout "${layout.name}"`,
    }),
  );
}

export function applyPaneLayout(threadRef: ScopedThreadRef, layoutId: string): void {
  usePaneLayoutStore.getState().requestApply(rightPanelHostRef(threadRef), layoutId);
}

export function deletePaneLayout(layoutId: string): void {
  const store = usePaneLayoutStore.getState();
  const index = store.layouts.findIndex((entry) => entry.id === layoutId);
  const layout = store.deleteLayout(layoutId);
  if (!layout) return;
  toastManager.add(
    stackedThreadToast({
      type: "info",
      title: `Deleted layout "${layout.name}"`,
      actionProps: {
        children: "Undo",
        onClick: () => usePaneLayoutStore.getState().restoreLayout(layout, index),
      },
    }),
  );
}
