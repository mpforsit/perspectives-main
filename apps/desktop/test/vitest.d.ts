/// <reference types="@testing-library/jest-dom" />
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // Augment vitest's Assertion + AsymmetricMatchersContaining with jest-dom matchers.
  // The void second type param matches @testing-library/jest-dom/vitest's own augmentation.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown> extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<typeof expect.stringContaining, void> {}
}
