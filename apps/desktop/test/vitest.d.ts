/// <reference types="@testing-library/jest-dom" />
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // Augment vitest's Assertion + AsymmetricMatchersContaining with jest-dom matchers.
  // The void second type param matches @testing-library/jest-dom/vitest's own augmentation.
  interface Assertion<T = unknown> extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<typeof expect.stringContaining, void> {}
}
