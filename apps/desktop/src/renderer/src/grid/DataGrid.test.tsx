import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { DataGrid, cycleSort } from "./DataGrid";
import { MOCK_COLUMNS, makeMockRows } from "./mock";
import type { SortSpec } from "./types";

describe("cycleSort", () => {
  it("starts at asc when nothing is sorted", () => {
    expect(cycleSort(null, "id")).toEqual({ column: "id", direction: "asc" });
  });

  it("goes asc → desc on the same column", () => {
    expect(cycleSort({ column: "id", direction: "asc" }, "id")).toEqual({
      column: "id",
      direction: "desc",
    });
  });

  it("goes desc → null on the same column", () => {
    expect(cycleSort({ column: "id", direction: "desc" }, "id")).toBeNull();
  });

  it("resets to asc when switching columns", () => {
    expect(cycleSort({ column: "id", direction: "desc" }, "name")).toEqual({
      column: "name",
      direction: "asc",
    });
  });
});

describe("DataGrid (DOM)", () => {
  beforeEach(() => {
    // jsdom doesn't implement ResizeObserver or these layout properties — the
    // virtualizer needs them to know the viewport is non-zero.
    if (typeof globalThis.ResizeObserver === "undefined") {
      class RO {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      Reflect.set(globalThis, "ResizeObserver", RO);
    }
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 600;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 1200;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 4000;
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders column headers with the dbType chips", () => {
    render(
      <DataGrid columns={MOCK_COLUMNS} rows={makeMockRows(10)} sort={null} />,
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    // dbType chips are rendered too
    const chips = screen.getAllByText("int4");
    expect(chips.length).toBeGreaterThan(0);
  });

  it("emits the right sort sequence when headers are clicked", () => {
    const onSortChange = vi.fn<(s: SortSpec | null) => void>();
    const { rerender } = render(
      <DataGrid
        columns={MOCK_COLUMNS}
        rows={makeMockRows(5)}
        sort={null}
        onSortChange={onSortChange}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /id/i });
    const headerBtn = header.querySelector("button");
    if (headerBtn === null) throw new Error("header button missing");

    fireEvent.click(headerBtn);
    expect(onSortChange).toHaveBeenLastCalledWith({ column: "id", direction: "asc" });

    rerender(
      <DataGrid
        columns={MOCK_COLUMNS}
        rows={makeMockRows(5)}
        sort={{ column: "id", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(headerBtn);
    expect(onSortChange).toHaveBeenLastCalledWith({ column: "id", direction: "desc" });

    rerender(
      <DataGrid
        columns={MOCK_COLUMNS}
        rows={makeMockRows(5)}
        sort={{ column: "id", direction: "desc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(headerBtn);
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });

  it("shows the empty message when there are no rows", () => {
    render(<DataGrid columns={MOCK_COLUMNS} rows={[]} emptyMessage="No rows here." />);
    expect(screen.getByText("No rows here.")).toBeInTheDocument();
  });

  it("shows the loading skeleton when loading=true", () => {
    render(<DataGrid columns={MOCK_COLUMNS} rows={[]} loading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("invokes onReachEnd once per row-count when scrolled near the bottom", () => {
    const onReachEnd = vi.fn();
    const { container } = render(
      <DataGrid columns={MOCK_COLUMNS} rows={makeMockRows(100)} onReachEnd={onReachEnd} />,
    );
    const scroller = container.querySelector("[role=grid] > div") as HTMLDivElement | null;
    if (scroller === null) throw new Error("scroller missing");
    // Position scroll near the bottom of the (mocked) 4000px content.
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 3500 });
    fireEvent.scroll(scroller);
    expect(onReachEnd).toHaveBeenCalledTimes(1);
    // Another scroll while count is unchanged → no double-fire.
    fireEvent.scroll(scroller);
    expect(onReachEnd).toHaveBeenCalledTimes(1);
  });
});
