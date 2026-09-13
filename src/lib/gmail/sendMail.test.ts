import { describe, expect, it } from "vitest";
import { buildRawMessage } from "./sendMail";

function decode(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

describe("buildRawMessage", () => {
  it("includes the recipient, an encoded subject, and the body", () => {
    const raw = buildRawMessage("rjredwards@gmail.com", "You won!", "Details inside.");
    const decoded = decode(raw);
    expect(decoded).toContain("To: rjredwards@gmail.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain("Details inside.");
  });

  it("is URL-safe base64 (no +, /, or padding)", () => {
    const raw = buildRawMessage("a@b.com", "win win win", "x".repeat(100));
    expect(raw).not.toMatch(/[+/=]/);
  });
});
