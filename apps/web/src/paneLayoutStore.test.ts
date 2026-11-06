import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  capturePaneLayout,
  type PaneLayout,
  planPaneLayoutApply,
  usePaneLayoutStore,
} from "./paneLayoutStore";
import type { ThreadRightPanelState } from "./rightPanelStore";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));
const simulator = {
  hostId: "host-1",
  deviceId: "sim-1",
  platform: "ios" as const,
  name: "iPhone 16 Pro",
};

const session = (tabId: string, url: string): PreviewSessionSnapshot => ({
  threadId: "thread-1",
  tabId,
  navStatus: { _tag: "Success", url, title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const layout = (overrides: Partial<PaneLayout> = {}): PaneLayout => ({
  id: "layout-1",
  name: "iOS development",
  tabs: [],
  activeTabIndex: null,
  widthFraction: null,
  maximized: false,
  ...overrides,
});

beforeEach(() => {
  usePaneLayoutStore.setState({ layouts: [], pendingApplyByThreadKey: {} });
});

describe("capturePaneLayout", () => {
  it("keeps reusable tabs, browser URLs and width share, and drops thread-bound tabs", () => {
    const panel: ThreadRightPanelState = {
      isOpen: true,
      activeSurfaceId: "device:host-1:sim-1",
      surfaces: [
        { id: "browser:tab_a", kind: "preview", resourceId: "tab_a" },
        {
          id: "pull-request:p:o%2Fr:1",
          kind: "pull-request",
          projectId: "p",
          repository: "o/r",
          number: 1,
        },
        {
          id: "terminal:term-1",
          kind: "terminal",
          resourceId: "term-1",
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
        },
        { id: "device:host-1:sim-1", kind: "device", target: simulator },
      ],
    };

    const captured = capturePaneLayout({
      id: "layout-1",
      name: "  iOS development ",
      panel,
      previewSessions: { tab_a: session("tab_a", "http://localhost:8081/") },
      panelWidth: 360,
      viewportWidth: 1440,
    });

    expect(captured).toEqual({
      id: "layout-1",
      name: "iOS development",
      tabs: [
        { kind: "browser", url: "http://localhost:8081/" },
        { kind: "terminal" },
        { kind: "device", target: simulator },
      ],
      activeTabIndex: 2,
      widthFraction: 0.25,
      maximized: false,
    });
  });
});

describe("planPaneLayoutApply", () => {
  it("reuses tabs the thread already shows and opens only the rest", () => {
    const panel: ThreadRightPanelState = {
      isOpen: true,
      activeSurfaceId: "terminal:term-1",
      surfaces: [
        {
          id: "terminal:term-1",
          kind: "terminal",
          resourceId: "term-1",
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
        },
        { id: "browser:tab_a", kind: "preview", resourceId: "tab_a" },
        { id: "browser:tab_blank", kind: "preview", resourceId: "tab_blank" },
      ],
    };

    const plan = planPaneLayoutApply({
      layout: layout({
        tabs: [
          { kind: "terminal" },
          { kind: "terminal" },
          { kind: "browser", url: "http://localhost:8081/" },
          { kind: "browser", url: "http://localhost:3000/" },
          { kind: "browser", url: null },
          { kind: "device", target: simulator },
        ],
      }),
      panel,
      previewSessions: {
        tab_a: session("tab_a", "http://localhost:8081/"),
        tab_blank: { ...session("tab_blank", ""), navStatus: { _tag: "Idle" } },
      },
    });

    expect(plan.map((entry) => entry.existingSurfaceId)).toEqual([
      "terminal:term-1",
      null,
      "browser:tab_a",
      null,
      "browser:tab_blank",
      null,
    ]);
  });
});

describe("usePaneLayoutStore", () => {
  it("replaces a layout saved under the same name and hands a pending apply out once", () => {
    const store = usePaneLayoutStore.getState();
    store.saveLayout(layout({ id: "first", widthFraction: 0.4 }));
    const { replaced } = store.saveLayout(
      layout({ id: "second", name: "IOS Development", widthFraction: 0.25 }),
    );

    expect(replaced?.id).toBe("first");
    expect(usePaneLayoutStore.getState().layouts).toEqual([
      layout({ id: "first", name: "IOS Development", widthFraction: 0.25 }),
    ]);

    store.requestApply(ref, "first");
    expect(usePaneLayoutStore.getState().takePendingApply(ref)?.id).toBe("first");
    expect(usePaneLayoutStore.getState().takePendingApply(ref)).toBeNull();
  });
});
