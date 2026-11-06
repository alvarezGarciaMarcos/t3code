import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayoutTemplateIcon, SaveIcon, Trash2Icon } from "lucide-react";

import { applyPaneLayout, deletePaneLayout, saveThreadPaneLayout } from "../../paneLayoutActions";
import { describePaneLayout, usePaneLayoutStore } from "../../paneLayoutStore";
import { requestPaneLayoutName } from "../SavePaneLayoutDialog";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

export function PaneLayoutMenu(props: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = props;
  const layouts = usePaneLayoutStore((state) => state.layouts);
  if (!threadRef) return null;

  const saveCurrent = async () => {
    const name = await requestPaneLayoutName();
    if (name) saveThreadPaneLayout(threadRef, name);
  };

  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Pane layouts" size="icon-sm" variant="ghost" />}>
        <LayoutTemplateIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        <MenuGroup>
          <MenuGroupLabel>Load layout</MenuGroupLabel>
          {layouts.length === 0 ? (
            <MenuItem disabled>
              <MenuItemLabel>No saved layouts yet</MenuItemLabel>
            </MenuItem>
          ) : (
            layouts.map((layout) => (
              <MenuItem key={layout.id} onClick={() => applyPaneLayout(threadRef, layout.id)}>
                <span className="flex min-w-0 flex-col">
                  <MenuItemLabel>{layout.name}</MenuItemLabel>
                  <span className="truncate text-muted-foreground text-xs">
                    {describePaneLayout(layout)}
                  </span>
                </span>
              </MenuItem>
            ))
          )}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={() => void saveCurrent()}>
          <SaveIcon />
          <MenuItemLabel>Save current layout…</MenuItemLabel>
        </MenuItem>
        {layouts.length > 0 ? (
          <MenuSub>
            <MenuSubTrigger>
              <Trash2Icon />
              <span className="flex-1">Delete layout</span>
            </MenuSubTrigger>
            <MenuSubPopup>
              {layouts.map((layout) => (
                <MenuItem
                  key={layout.id}
                  variant="destructive"
                  onClick={() => deletePaneLayout(layout.id)}
                >
                  <MenuItemLabel>{layout.name}</MenuItemLabel>
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
