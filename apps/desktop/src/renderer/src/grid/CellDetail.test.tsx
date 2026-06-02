import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CellDetailDialog } from "./CellDetail";

describe("CellDetailDialog", () => {
  beforeEach(() => {
    // jsdom doesn't ship a clipboard API by default — install a spy.
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    // Radix sometimes warns about a hasPointerCapture stub; jsdom is fine
    // for our static-render assertions but the warning is noisy in test logs.
    if (typeof Element.prototype.hasPointerCapture !== "function") {
      Reflect.set(Element.prototype, "hasPointerCapture", () => false);
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when target is null", () => {
    const { container } = render(
      <CellDetailDialog target={null} onClose={() => undefined} />,
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the column label, dbType, and 'NULL' description for a null cell", () => {
    render(
      <CellDetailDialog
        target={{ label: "deleted_at", dbType: "timestamptz", value: null }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("deleted_at")).toBeInTheDocument();
    expect(screen.getByText("timestamptz")).toBeInTheDocument();
    expect(screen.getByText(/NULL — this cell has no value\./)).toBeInTheDocument();
  });

  it("renders long text wrapped in a pre", () => {
    const long = "x".repeat(500);
    render(
      <CellDetailDialog
        target={{ label: "bio", dbType: "text", value: long }}
        onClose={() => undefined}
      />,
    );
    const pre = screen.getByText(long);
    expect(pre.tagName).toBe("PRE");
  });

  it("renders json as a tree with keys visible", () => {
    render(
      <CellDetailDialog
        target={{ label: "meta", dbType: "jsonb", value: { score: 9, tags: ["a", "b"] } }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('"score"')).toBeInTheDocument();
    expect(screen.getByText('"tags"')).toBeInTheDocument();
    expect(screen.getByText('"a"')).toBeInTheDocument();
  });

  it("parses a JSON string before rendering the tree (some drivers return strings)", () => {
    render(
      <CellDetailDialog
        target={{
          label: "meta",
          dbType: "jsonb",
          value: '{"score":9,"tags":["a","b"]}',
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('"score"')).toBeInTheDocument();
  });

  it("renders bytea with a length note + hex preview", () => {
    render(
      <CellDetailDialog
        target={{
          label: "avatar",
          dbType: "bytea",
          value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/4 bytes/)).toBeInTheDocument();
    expect(screen.getByText("de ad be ef")).toBeInTheDocument();
  });

  it("Copy raw writes the verbatim string for a text cell", () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CellDetailDialog
        target={{ label: "bio", dbType: "text", value: "hello world" }}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy raw/i }));
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("Copy raw writes JSON for a structured cell", () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CellDetailDialog
        target={{ label: "meta", dbType: "jsonb", value: { a: 1 } }}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy raw/i }));
    expect(writeText).toHaveBeenCalledWith('{"a":1}');
  });

  it("Close button invokes onClose", () => {
    const onClose = vi.fn();
    render(
      <CellDetailDialog
        target={{ label: "x", dbType: "text", value: "hi" }}
        onClose={onClose}
      />,
    );
    // Both Radix's built-in X (sr-only "Close") and our footer button match
    // "Close" — disambiguate by picking the footer button explicitly.
    const closes = screen.getAllByRole("button", { name: /close/i });
    const footerClose = closes.find((btn) => btn.textContent?.trim() === "Close");
    if (footerClose === undefined) throw new Error("footer close button missing");
    fireEvent.click(footerClose);
    expect(onClose).toHaveBeenCalled();
  });
});
