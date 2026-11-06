import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  type PaneLayout,
  type PaneLayoutTab,
  paneLayoutWidthPx,
  planPaneLayoutApply,
  usePaneLayoutStore,
} from "../../paneLayoutStore";
import { readThreadPreviewState } from "../../previewStateStore";
import { rightPanelWidthStorageKey } from "../../rightPanelLayout";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import type { useDeviceState } from "../../state/device";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { openPreviewSession } from "../preview/openPreviewSession";
import { stackedThreadToast, toastManager } from "../ui/toast";

interface PaneLayoutApplierInput {
  readonly activeThreadRef: ScopedThreadRef | null;
  /** A side chat pane has no panel of its own. */
  readonly embedded: boolean;
  readonly browserAvailable: boolean;
  readonly workspaceAvailable: boolean;
  readonly diffAvailable: boolean;
  readonly pullRequestsAvailable: boolean;
  readonly deviceState: ReturnType<typeof useDeviceState>["state"];
  readonly deviceStateLoaded: boolean;
  /** Opens a terminal tab without focusing it; null when the thread cannot run one. */
  readonly launchPanelTerminal: () => string | null;
}

const TAB_LABELS: Record<PaneLayoutTab["kind"], string> = {
  browser: "Browser",
  terminal: "Terminal",
  files: "Files",
  file: "File",
  diff: "Diff",
  "pull-requests": "Linked pull requests",
  device: "Device",
};

/** Applies layouts requested through `usePaneLayoutStore.requestApply` to the open thread. */
export function usePaneLayoutApplier(input: PaneLayoutApplierInput): void {
  const { activeThreadRef, embedded } = input;
  const openPreview = useAtomCommand(previewEnvironment.open);
  const pendingLayoutId = usePaneLayoutStore((state) =>
    activeThreadRef
      ? (state.pendingApplyByThreadKey[scopedThreadKey(activeThreadRef)] ?? null)
      : null,
  );

  const openTab = async (ref: ScopedThreadRef, tab: PaneLayoutTab): Promise<string | null> => {
    const panels = useRightPanelStore.getState();
    switch (tab.kind) {
      case "browser": {
        if (!input.browserAvailable) return null;
        const result = await openPreviewSession({
          openPreview,
          threadRef: ref,
          ...(tab.url === null ? {} : { url: tab.url }),
        });
        if (result._tag === "Failure") return null;
        panels.openBrowser(ref, result.value.tabId);
        return `browser:${result.value.tabId}`;
      }
      case "terminal": {
        const terminalId = input.launchPanelTerminal();
        return terminalId === null ? null : `terminal:${terminalId}`;
      }
      case "files":
        if (!input.workspaceAvailable) return null;
        panels.open(ref, "files");
        return "files";
      case "file":
        if (!input.workspaceAvailable) return null;
        panels.openFile(ref, tab.relativePath);
        return `file:${tab.relativePath}`;
      case "diff":
        if (!input.diffAvailable) return null;
        panels.open(ref, "diff");
        return "diff";
      case "pull-requests":
        if (!input.pullRequestsAvailable) return null;
        panels.open(ref, "pull-requests");
        return "pull-requests";
      case "device": {
        const { deviceState } = input;
        if (!deviceState.onboardingCompleted || deviceState.hostStatus === "disabled") return null;
        const target = tab.target;
        const known =
          target !== null &&
          (!input.deviceStateLoaded ||
            deviceState.devices.some(
              (device) => device.hostId === target.hostId && device.id === target.deviceId,
            ));
        if (!known) {
          // The saved simulator is gone, so offer the picker instead.
          panels.open(ref, "device");
          return "device";
        }
        panels.openDevice(ref, target);
        const surfaceId =
          `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
        if (tab.title) panels.renameDevice(ref, surfaceId, tab.title);
        return surfaceId;
      }
    }
  };

  const applyLayout = useStableCallback(async (ref: ScopedThreadRef, layout: PaneLayout) => {
    const viewportWidth = window.innerWidth;
    const widthPx = paneLayoutWidthPx(layout, viewportWidth);
    if (widthPx !== null) {
      writeLocalStorageValue(
        rightPanelWidthStorageKey(scopedThreadKey(ref)),
        widthPx,
        widthPx,
        Schema.Finite,
      );
    }
    if (layout.tabs.length === 0) {
      useRightPanelStore.getState().setMaximized(ref, false);
      useRightPanelStore.getState().close(ref);
      return;
    }

    const plan = planPaneLayoutApply({
      layout,
      panel: selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref),
      previewSessions: readThreadPreviewState(ref).sessions,
    });
    const surfaceIds: Array<string | null> = [];
    const skipped: string[] = [];
    for (const { tab, existingSurfaceId } of plan) {
      const surfaceId = existingSurfaceId ?? (await openTab(ref, tab));
      if (surfaceId === null) skipped.push(TAB_LABELS[tab.kind]);
      surfaceIds.push(surfaceId);
    }

    const panels = useRightPanelStore.getState();
    const activeSurfaceId =
      (layout.activeTabIndex === null ? null : surfaceIds[layout.activeTabIndex]) ??
      surfaceIds.find((id) => id !== null) ??
      null;
    if (activeSurfaceId !== null) panels.activateSurface(ref, activeSurfaceId);
    panels.setMaximized(ref, layout.maximized);

    if (skipped.length > 0) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: `Some tabs from "${layout.name}" did not open`,
          description: `Not available in this thread: ${[...new Set(skipped)].join(", ")}.`,
        }),
      );
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs layout requests made outside this view, such as from the command palette, once the thread is on screen
  useEffect(() => {
    if (embedded || !activeThreadRef || pendingLayoutId === null) return;
    const layout = usePaneLayoutStore.getState().takePendingApply(activeThreadRef);
    if (layout) void applyLayout(activeThreadRef, layout);
  }, [embedded, activeThreadRef, pendingLayoutId, applyLayout]);
}
