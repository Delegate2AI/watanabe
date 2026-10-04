// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { ScrollArea } from "./scroll-area";
import { Toaster } from "./sonner";
import { toast } from "sonner";

describe("Dialog", () => {
  it("opens on trigger and closes via the close button", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Body text</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Confirm")).toBeNull();
    await user.click(screen.getByText("Open dialog"));
    expect(await screen.findByText("Confirm")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("Confirm")).toBeNull());
  });
});

describe("DropdownMenu", () => {
  it("opens and fires the selected item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText("Menu"));
    const item = await screen.findByRole("menuitem", { name: "Rename" });
    await user.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("Tooltip", () => {
  it("reveals content when the trigger is focused", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Helpful hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    // Radix renders the content plus an a11y copy; at least one is present.
    await waitFor(() =>
      expect(screen.getAllByText("Helpful hint").length).toBeGreaterThan(0),
    );
  });
});

describe("Tabs", () => {
  it("switches the visible panel on tab click", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="rendered">
        <TabsList>
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="markdown">Markdown</TabsTrigger>
        </TabsList>
        <TabsContent value="rendered">Rendered view</TabsContent>
        <TabsContent value="markdown">Markdown view</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("Rendered view")).toBeInTheDocument();
    expect(screen.queryByText("Markdown view")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(await screen.findByText("Markdown view")).toBeInTheDocument();
  });
});

describe("ScrollArea", () => {
  it("renders children inside the scroll viewport", () => {
    const { container } = render(
      <ScrollArea>
        <p>long scrollable content</p>
      </ScrollArea>,
    );
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(viewport).not.toBeNull();
    expect(viewport).toHaveTextContent("long scrollable content");
  });
});

describe("Toaster (sonner)", () => {
  it("shows a toast raised via the sonner API", async () => {
    render(<Toaster />);
    toast("Draft saved");
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
  });
});
