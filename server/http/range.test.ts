import { describe, expect, it } from "vitest";
import { parseRange } from "./index";

describe("parseRange", () => {
  const size = 1000;

  it("parses a bounded range", () => {
    expect(parseRange("bytes=10-19", size)).toEqual({ start: 10, end: 19 });
  });

  it("parses an open-ended range", () => {
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });

  it("parses a suffix range", () => {
    expect(parseRange("bytes=-100", size)).toEqual({ start: 900, end: 999 });
  });

  it("clamps the end to the file size", () => {
    expect(parseRange("bytes=990-5000", size)).toEqual({ start: 990, end: 999 });
  });

  it("rejects malformed or out-of-bounds ranges", () => {
    expect(parseRange("bytes=abc", size)).toBeNull();
    expect(parseRange("bytes=-", size)).toBeNull();
    expect(parseRange("bytes=0-0,10-20", size)).toBeNull();
    expect(parseRange("bytes=1000-1001", size)).toBeNull();
    expect(parseRange("bytes=500-100", size)).toBeNull();
  });
});
