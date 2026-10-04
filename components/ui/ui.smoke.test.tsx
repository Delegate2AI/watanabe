// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { Input } from "./input";
import { Badge } from "./badge";
import { Avatar, AvatarFallback } from "./avatar";
import { Separator } from "./separator";

/**
 * Smoke test standing in for the plan's "scratch page renders one of each
 * primitive" check: proves the shadcn primitives mount and carry OUR token
 * utilities (bg-accent, border-line, ...) rather than shadcn defaults
 * (bg-primary, border-input). A durable test beats a throwaway route.
 */
describe("ui primitives", () => {
  it("Button renders with the accent token, not shadcn's bg-primary", () => {
    render(<Button>Send</Button>);
    const btn = screen.getByRole("button", { name: "Send" });
    expect(btn).toHaveClass("bg-accent");
    expect(btn.className).not.toContain("bg-primary");
  });

  it("Input uses the surface/line tokens", () => {
    render(<Input placeholder="Ask" />);
    const input = screen.getByPlaceholderText("Ask");
    expect(input).toHaveClass("bg-surface");
    expect(input).toHaveClass("border-line");
  });

  it("Badge good/warn variants map to semantic tokens", () => {
    const { rerender } = render(<Badge variant="good">All-hands</Badge>);
    expect(screen.getByText("All-hands")).toHaveClass("bg-good-soft");
    rerender(<Badge variant="warn">Exec</Badge>);
    expect(screen.getByText("Exec")).toHaveClass("bg-warn-soft");
  });

  it("Avatar fallback uses the accent badge styling", () => {
    render(
      <Avatar>
        <AvatarFallback>N</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("N")).toHaveClass("bg-accent");
  });

  it("Separator is a hairline in the line token", () => {
    const { container } = render(<Separator />);
    expect(container.querySelector('[data-slot="separator"]')).toHaveClass(
      "bg-line",
    );
  });
});
