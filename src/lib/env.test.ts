import { describe, expect, it } from "vitest";

import { normalizeOrigin } from "./env";

describe("normalizeOrigin", () => {
  it("removes a trailing slash", () => {
    // Otherwise `${siteUrl}/join/x` becomes `https://host//join/x`.
    expect(normalizeOrigin("https://gas-split-app.vercel.app/")).toBe(
      "https://gas-split-app.vercel.app",
    );
  });

  it("removes several", () => {
    expect(normalizeOrigin("https://example.com///")).toBe("https://example.com");
  });

  it("leaves a clean origin alone", () => {
    expect(normalizeOrigin("https://example.com")).toBe("https://example.com");
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("ignores surrounding whitespace, which pasted values carry", () => {
    expect(normalizeOrigin("  https://example.com/  ")).toBe("https://example.com");
  });

  it("does not eat the slashes after the scheme", () => {
    expect(normalizeOrigin("https://")).toBe("https:");
    expect(normalizeOrigin("https://example.com/path/")).toBe("https://example.com/path");
  });
});
