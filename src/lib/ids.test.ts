import { describe, expect, it } from "vitest";

import { isUuid } from "./ids";

describe("isUuid", () => {
  it("accepts a uuid in either case", () => {
    expect(isUuid("4bd78a38-8b6b-45a3-9bea-06c1cebbac12")).toBe(true);
    expect(isUuid("4BD78A38-8B6B-45A3-9BEA-06C1CEBBAC12")).toBe(true);
  });

  it("rejects anything Postgres would raise on", () => {
    // These must produce a 404, not "something went wrong".
    expect(isUuid("does-not-exist")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("4bd78a38-8b6b-45a3-9bea")).toBe(false);
    expect(isUuid("4bd78a38-8b6b-45a3-9bea-06c1cebbac12-extra")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
    expect(isUuid("zzzzzzzz-8b6b-45a3-9bea-06c1cebbac12")).toBe(false);
  });
});
