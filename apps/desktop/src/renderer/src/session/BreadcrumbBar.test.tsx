// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BreadcrumbBar } from "./TableView";
import type { BreadcrumbStep } from "./links";

function makeCrumb(table: string, id: number): BreadcrumbStep {
  return {
    schema: "public",
    table,
    label: `${table}[${id}]`,
    filter: {
      op: "and",
      children: [{ column: "id", op: "eq", value: id }],
    },
  };
}

afterEach(cleanup);

describe("BreadcrumbBar (DOM)", () => {
  it("renders 4 hops inline — no ellipsis dropdown", () => {
    const crumbs = [
      makeCrumb("customers", 1),
      makeCrumb("orders", 42),
      makeCrumb("order_items", 7),
      makeCrumb("products", 3),
    ];
    render(
      <BreadcrumbBar
        crumbs={crumbs}
        resolvedLabels={new Map()}
        onOpenTab={() => undefined}
      />,
    );

    // Every persisted label is visible.
    expect(screen.getByText("customers[1]")).toBeDefined();
    expect(screen.getByText("orders[42]")).toBeDefined();
    expect(screen.getByText("order_items[7]")).toBeDefined();
    expect(screen.getByText("products[3]")).toBeDefined();
    // No overflow control.
    expect(
      screen.queryByLabelText(/hidden steps?/i),
    ).toBeNull();
  });

  it("collapses 5 hops into head + dropdown + last two", () => {
    const crumbs = [
      makeCrumb("customers", 1),
      makeCrumb("orders", 42),
      makeCrumb("order_items", 7),
      makeCrumb("products", 3),
      makeCrumb("categories", 12),
    ];
    render(
      <BreadcrumbBar
        crumbs={crumbs}
        resolvedLabels={new Map()}
        onOpenTab={() => undefined}
      />,
    );

    // Head + last two rendered inline.
    expect(screen.getByText("customers[1]")).toBeDefined();
    expect(screen.getByText("products[3]")).toBeDefined();
    expect(screen.getByText("categories[12]")).toBeDefined();

    // The middle crumbs are hidden — not in the DOM until the dropdown opens.
    expect(screen.queryByText("orders[42]")).toBeNull();
    expect(screen.queryByText("order_items[7]")).toBeNull();

    // Overflow button announces its hidden count.
    const overflow = screen.getByLabelText(/2 hidden steps/i);
    expect(overflow).toBeDefined();

    // Opening the dropdown reveals the hidden crumbs.
    fireEvent.click(overflow);
    expect(screen.getByText("orders[42]")).toBeDefined();
    expect(screen.getByText("order_items[7]")).toBeDefined();
  });

  it("prefers resolvedLabels over the persisted PK-based label", () => {
    const crumbs = [makeCrumb("customers", 1), makeCrumb("orders", 42)];
    render(
      <BreadcrumbBar
        crumbs={crumbs}
        resolvedLabels={new Map([[0, "Ada Lovelace (FR)"]])}
        onOpenTab={() => undefined}
      />,
    );
    // Head crumb takes the resolved label.
    expect(screen.getByText("Ada Lovelace (FR)")).toBeDefined();
    // Tail crumb still uses the persisted label (no resolved entry).
    expect(screen.getByText("orders[42]")).toBeDefined();
  });

  it("back arrow opens the second-to-last crumb", () => {
    const opened: unknown[] = [];
    const crumbs = [
      makeCrumb("customers", 1),
      makeCrumb("orders", 42),
      makeCrumb("order_items", 7),
    ];
    render(
      <BreadcrumbBar
        crumbs={crumbs}
        resolvedLabels={new Map()}
        onOpenTab={(tab) => opened.push(tab)}
      />,
    );

    fireEvent.click(screen.getByLabelText(/back one step/i));
    expect(opened).toHaveLength(1);
    const opened0 = opened[0] as { kind: string; schema: string; name: string };
    expect(opened0.kind).toBe("filteredTable");
    // Previous step is `orders`, index 1.
    expect(opened0.name).toBe("orders");
  });

  it("back arrow is disabled on single-hop trails", () => {
    render(
      <BreadcrumbBar
        crumbs={[makeCrumb("customers", 1)]}
        resolvedLabels={new Map()}
        onOpenTab={() => undefined}
      />,
    );
    const back = screen.getByLabelText(/back one step/i) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });
});
