import { describe, expect, it } from "vitest";
import { buildJoinUrl } from "./invite";

describe("buildJoinUrl", () => {
  it("builds the join deep link from origin and room id", () => {
    expect(buildJoinUrl("http://192.168.1.20:3000", "01HQZ8K5V6M7N8P9Q0R1S2T3V4")).toBe(
      "http://192.168.1.20:3000/join?room=01HQZ8K5V6M7N8P9Q0R1S2T3V4",
    );
  });

  it("drops a trailing slash on the origin", () => {
    expect(buildJoinUrl("http://hub.local:3000/", "ROOM1")).toBe(
      "http://hub.local:3000/join?room=ROOM1",
    );
  });

  it("encodes the room id and trims whitespace", () => {
    expect(buildJoinUrl("http://hub.local", " a b ")).toBe(
      "http://hub.local/join?room=a%20b",
    );
  });
});
