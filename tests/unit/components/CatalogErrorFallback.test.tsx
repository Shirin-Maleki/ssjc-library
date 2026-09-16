// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogErrorFallback } from "@/components/catalog/CatalogErrorFallback";

/**
 * Component-level coverage for the Phase 4 correction pass's catalog error boundary
 * (`find/error.tsx`, `books/[id]/error.tsx`) — the actual Next.js error-boundary
 * wiring can't be exercised without a real thrown server-render error, but the
 * user-facing contract (calm message, no raw error detail, a working retry) is fully
 * testable at this level.
 */
describe("CatalogErrorFallback", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the calm, generic message rather than the raw error", () => {
    const error = Object.assign(new Error("connection to server at \"127.0.0.1\", port 5432 failed"), {
      digest: "abc123",
    });
    render(<CatalogErrorFallback error={error} reset={vi.fn()} />);

    expect(screen.getByText("Library information couldn’t be loaded right now")).toBeTruthy();
    expect(screen.getByText("Please try again.")).toBeTruthy();
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(screen.queryByText(/5432/)).toBeNull();
    expect(screen.queryByText(/connection to server/i)).toBeNull();
  });

  it("never renders a SQL/driver-shaped error message even when it's the error's own text", () => {
    const error = new Error("relation \"books\" does not exist");
    render(<CatalogErrorFallback error={error} reset={vi.fn()} />);
    expect(screen.queryByText(/relation/i)).toBeNull();
    expect(screen.queryByText(/does not exist/i)).toBeNull();
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    render(<CatalogErrorFallback error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
