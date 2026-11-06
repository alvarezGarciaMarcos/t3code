import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import type { RightPanelSurface, ThreadRightPanelState } from "./rightPanelStore";

const PANE_LAYOUT_STORAGE_KEY = "t3code:pane-layouts:v1";

const DeviceTabTargetSchema = Schema.Struct({
  hostId: Schema.String,
  deviceId: Schema.String,
  platform: Schema.Literals(["ios", "android"]),
  name: Schema.String,
});

const PaneLayoutTabSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("browser"), url: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("terminal") }),
  Schema.Struct({ kind: Schema.Literal("files") }),
  Schema.Struct({ kind: Schema.Literal("file"), relativePath: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("diff") }),
  Schema.Struct({ kind: Schema.Literal("pull-requests") }),
  Schema.Struct({
    kind: Schema.Literal("device"),
    target: Schema.NullOr(DeviceTabTargetSchema),
    title: Schema.optionalKey(Schema.String),
  }),
]);
export type PaneLayoutTab = typeof PaneLayoutTabSchema.Type;

const PaneLayoutSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tabs: Schema.Array(PaneLayoutTabSchema),
  activeTabIndex: Schema.NullOr(Schema.Number),
  /** Panel width as a share of the window width; null keeps the thread's current width. */
  widthFraction: Schema.NullOr(Schema.Number),
  maximized: Schema.Boolean,
});
export type PaneLayout = typeof PaneLayoutSchema.Type;

const decodeLayouts = Schema.decodeUnknownSync(Schema.Array(PaneLayoutSchema));

const MIN_WIDTH_FRACTION = 0.1;
const MAX_WIDTH_FRACTION = 0.9;

function browserTabUrl(snapshot: PreviewSessionSnapshot | undefined): string | null {
  if (!snapshot || snapshot.navStatus._tag === "Idle") return null;
  return snapshot.navStatus.url;
}

function surfaceToLayoutTab(
  surface: RightPanelSurface,
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): PaneLayoutTab | null {
  switch (surface.kind) {
    case "preview":
      return {
        kind: "browser",
        url:
          surface.resourceId === null ? null : browserTabUrl(previewSessions[surface.resourceId]),
      };
    case "terminal":
      return { kind: "terminal" };
    case "files":
      return { kind: "files" };
    case "file":
      return surface.attachment ? null : { kind: "file", relativePath: surface.relativePath };
    case "diff":
      return { kind: "diff" };
    case "pull-requests":
      return { kind: "pull-requests" };
    case "device":
      return {
        kind: "device",
        target: surface.target ?? null,
        ...(surface.title === undefined ? {} : { title: surface.title }),
      };
    // A specific pull request or side chat belongs to one thread, so it cannot be reused.
    case "pull-request":
    case "side-chat":
      return null;
  }
}

/** Snapshot of a thread's panel; tabs tied to one thread are left out. */
export function capturePaneLayout(input: {
  readonly id: string;
  readonly name: string;
  readonly panel: ThreadRightPanelState;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly panelWidth: number | null;
  readonly viewportWidth: number;
}): PaneLayout {
  const tabs: PaneLayoutTab[] = [];
  let activeTabIndex: number | null = null;
  for (const surface of input.panel.surfaces) {
    const tab = surfaceToLayoutTab(surface, input.previewSessions);
    if (!tab) continue;
    if (surface.id === input.panel.activeSurfaceId) activeTabIndex = tabs.length;
    tabs.push(tab);
  }
  const widthFraction =
    input.panelWidth === null || input.viewportWidth <= 0
      ? null
      : Math.round(
          Math.min(
            MAX_WIDTH_FRACTION,
            Math.max(MIN_WIDTH_FRACTION, input.panelWidth / input.viewportWidth),
          ) * 1000,
        ) / 1000;
  return {
    id: input.id,
    name: input.name.trim(),
    tabs,
    activeTabIndex: input.panel.isOpen ? activeTabIndex : null,
    widthFraction,
    maximized: input.panel.isOpen && input.panel.maximized === true,
  };
}

/**
 * Which layout tabs still need opening on a thread. Applying merges into the panel, so tabs the
 * thread already shows are matched to an existing surface instead of opening a duplicate.
 */
export function planPaneLayoutApply(input: {
  readonly layout: PaneLayout;
  readonly panel: ThreadRightPanelState;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
}): Array<{ readonly tab: PaneLayoutTab; readonly existingSurfaceId: string | null }> {
  const unclaimed = [...input.panel.surfaces];
  const claim = (match: (surface: RightPanelSurface) => boolean): string | null => {
    const index = unclaimed.findIndex(match);
    if (index === -1) return null;
    const [surface] = unclaimed.splice(index, 1);
    return surface?.id ?? null;
  };
  return input.layout.tabs.map((tab) => {
    switch (tab.kind) {
      case "browser":
        return {
          tab,
          existingSurfaceId: claim(
            (surface) =>
              surface.kind === "preview" &&
              (surface.resourceId === null
                ? tab.url === null
                : browserTabUrl(input.previewSessions[surface.resourceId]) === tab.url),
          ),
        };
      case "terminal":
        return { tab, existingSurfaceId: claim((surface) => surface.kind === "terminal") };
      case "file":
        return {
          tab,
          existingSurfaceId: claim(
            (surface) =>
              surface.kind === "file" &&
              !surface.attachment &&
              surface.relativePath === tab.relativePath,
          ),
        };
      case "device":
        return {
          tab,
          existingSurfaceId: claim(
            (surface) =>
              surface.kind === "device" &&
              (tab.target === null
                ? surface.target === undefined
                : surface.target?.hostId === tab.target.hostId &&
                  surface.target.deviceId === tab.target.deviceId),
          ),
        };
      case "files":
      case "diff":
      case "pull-requests":
        return { tab, existingSurfaceId: claim((surface) => surface.kind === tab.kind) };
    }
  });
}

export function paneLayoutWidthPx(layout: PaneLayout, viewportWidth: number): number | null {
  return layout.widthFraction === null ? null : Math.round(layout.widthFraction * viewportWidth);
}

export function describePaneLayout(layout: PaneLayout): string {
  if (layout.tabs.length === 0) return "Panel closed";
  const labels = layout.tabs.map((tab) => {
    switch (tab.kind) {
      case "browser":
        return "Browser";
      case "terminal":
        return "Terminal";
      case "files":
        return "Files";
      case "file":
        return tab.relativePath.split("/").at(-1) ?? tab.relativePath;
      case "diff":
        return "Diff";
      case "pull-requests":
        return "Pull requests";
      case "device":
        return tab.title ?? tab.target?.name ?? "Device";
    }
  });
  const width = layout.maximized
    ? "maximized"
    : layout.widthFraction === null
      ? null
      : `${Math.round(layout.widthFraction * 100)}% width`;
  return width === null ? labels.join(", ") : `${labels.join(", ")} · ${width}`;
}

interface PaneLayoutStoreState {
  layouts: readonly PaneLayout[];
  /** Thread keys waiting for their chat view to apply a layout; not persisted. */
  pendingApplyByThreadKey: Readonly<Record<string, string>>;
  /** Replaces a layout with the same name (ignoring case). */
  saveLayout: (layout: PaneLayout) => { replaced: PaneLayout | null };
  deleteLayout: (layoutId: string) => PaneLayout | null;
  /** Puts a deleted layout back where it was. */
  restoreLayout: (layout: PaneLayout, index: number) => void;
  requestApply: (ref: ScopedThreadRef, layoutId: string) => void;
  takePendingApply: (ref: ScopedThreadRef) => PaneLayout | null;
}

export const usePaneLayoutStore = create<PaneLayoutStoreState>()(
  persist(
    (set, get) => ({
      layouts: [],
      pendingApplyByThreadKey: {},
      saveLayout: (layout) => {
        const key = layout.name.toLocaleLowerCase();
        const layouts = get().layouts;
        const index = layouts.findIndex((entry) => entry.name.toLocaleLowerCase() === key);
        const replaced = index === -1 ? null : (layouts[index] ?? null);
        set({
          layouts:
            index === -1
              ? [...layouts, layout]
              : layouts.map((entry, i) => (i === index ? { ...layout, id: entry.id } : entry)),
        });
        return { replaced };
      },
      deleteLayout: (layoutId) => {
        const layout = get().layouts.find((entry) => entry.id === layoutId) ?? null;
        if (!layout) return null;
        set((state) => ({
          layouts: state.layouts.filter((entry) => entry.id !== layoutId),
          pendingApplyByThreadKey: Object.fromEntries(
            Object.entries(state.pendingApplyByThreadKey).filter(([, id]) => id !== layoutId),
          ),
        }));
        return layout;
      },
      restoreLayout: (layout, index) =>
        set((state) => {
          if (state.layouts.some((entry) => entry.id === layout.id)) return state;
          const layouts = [...state.layouts];
          layouts.splice(Math.min(index, layouts.length), 0, layout);
          return { layouts };
        }),
      requestApply: (ref, layoutId) =>
        set((state) => ({
          pendingApplyByThreadKey: {
            ...state.pendingApplyByThreadKey,
            [scopedThreadKey(ref)]: layoutId,
          },
        })),
      takePendingApply: (ref) => {
        const threadKey = scopedThreadKey(ref);
        const state = get();
        const layoutId = state.pendingApplyByThreadKey[threadKey];
        if (layoutId === undefined) return null;
        const { [threadKey]: _taken, ...pendingApplyByThreadKey } = state.pendingApplyByThreadKey;
        set({ pendingApplyByThreadKey });
        return state.layouts.find((entry) => entry.id === layoutId) ?? null;
      },
    }),
    {
      name: PANE_LAYOUT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ layouts: state.layouts }),
      merge: (persisted, current) => {
        const raw = (persisted as { layouts?: unknown } | null)?.layouts;
        try {
          return { ...current, layouts: raw === undefined ? [] : decodeLayouts(raw) };
        } catch (error) {
          console.error("Could not read saved pane layouts.", error);
          return current;
        }
      },
    },
  ),
);
