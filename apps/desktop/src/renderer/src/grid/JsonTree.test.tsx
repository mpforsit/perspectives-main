// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { JsonTree } from "./JsonTree";

describe("JsonTree", () => {
  afterEach(() => cleanup());

  it("renders primitives in-place", () => {
    const { container } = render(<JsonTree value={42} />);
    expect(container.textContent).toContain("42");
  });

  it("renders strings double-quoted", () => {
    render(<JsonTree value="hello" />);
    expect(screen.getByText('"hello"')).toBeInTheDocument();
  });

  it("renders null as italic 'null'", () => {
    const { container } = render(<JsonTree value={null} />);
    expect(container.textContent).toBe("null");
  });

  it("renders an object with keys at the default expansion depth", () => {
    render(<JsonTree value={{ a: 1, b: "two" }} />);
    expect(screen.getByText('"a"')).toBeInTheDocument();
    expect(screen.getByText('"b"')).toBeInTheDocument();
    expect(screen.getByText('"two"')).toBeInTheDocument();
  });

  it("collapses nested objects beyond the initial depth", () => {
    render(
      <JsonTree
        value={{ outer: { inner: { deep: 1 } } }}
        initiallyExpandedDepth={1}
      />,
    );
    // outer is shown at depth 0; inner is shown at depth 1; deep is hidden.
    expect(screen.getByText('"outer"')).toBeInTheDocument();
    expect(screen.queryByText('"deep"')).toBeNull();
  });

  it("toggles a composite node when its disclosure button is clicked", () => {
    render(<JsonTree value={{ outer: { inner: 1 } }} initiallyExpandedDepth={1} />);
    // 'inner' is hidden initially because outer is collapsed at depth 1.
    expect(screen.queryByText('"inner"')).toBeNull();
    const toggles = screen.getAllByLabelText("Expand");
    // Clicking the outer toggle should reveal the inner key.
    if (toggles[0] === undefined) throw new Error("toggle missing");
    fireEvent.click(toggles[0]);
    expect(screen.getByText('"inner"')).toBeInTheDocument();
  });

  it("renders arrays with indices and an item count when collapsed", () => {
    render(<JsonTree value={[10, 20, 30]} initiallyExpandedDepth={0} />);
    // Collapsed: a summary like "… 3 items …"
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it("renders empty composites with empty literals", () => {
    const { container: a } = render(<JsonTree value={[]} />);
    expect(a.textContent).toBe("[ ]");
    cleanup();
    const { container: b } = render(<JsonTree value={{}} />);
    expect(b.textContent).toBe("{ }");
  });
});
