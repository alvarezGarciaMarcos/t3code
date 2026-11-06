import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { usePaneLayoutStore } from "../paneLayoutStore";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Request = { readonly resolve: (name: string | null) => void };
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks for a layout name; null when cancelled. */
export function requestPaneLayoutName(): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { resolve } }));
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function SavePaneLayoutDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves any pending name request promise with null when the dialog host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <SavePaneLayoutDialog /> : null;
}

function SavePaneLayoutDialog() {
  const id = useId();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const existing = usePaneLayoutStore((state) =>
    state.layouts.find((layout) => layout.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) finish(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save pane layout</DialogTitle>
            <DialogDescription>
              Saves the open tabs, the active tab and the panel width so any thread can load them.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-name`}>
              Name
              <Input
                nativeInput
                id={`${id}-name`}
                className="h-9 sm:h-8"
                autoFocus
                required
                maxLength={60}
                placeholder="iOS development"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Label>
            {existing ? (
              <p className="mt-2 text-muted-foreground text-xs">
                This replaces the saved layout "{existing.name}".
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {existing ? "Replace" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
