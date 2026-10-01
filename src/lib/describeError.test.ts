import { describe, expect, it } from "vitest";
import { describeError } from "./describeError";
import { gmailApiId } from "./gmail/imapMailbox";

function gaxiosLike(error: string, error_description: string) {
  return Object.assign(new Error(error), {
    config: { headers: { "User-Agent": "google-api-nodejs-client" }, data: "<<REDACTED>>" },
    response: { status: 400, data: { error, error_description } },
  });
}

describe("describeError", () => {
  it("turns an expired Google token into one line that says how to fix it", () => {
    const line = describeError(gaxiosLike("invalid_grant", "Token has been expired or revoked."));
    expect(line).toContain("invalid_grant: Token has been expired or revoked.");
    expect(line).toContain("npm run gmail:auth");
    expect(line).not.toContain("\n");
    expect(line).not.toContain("User-Agent");
  });

  it("keeps an API error's code without dumping the request config", () => {
    const line = describeError(gaxiosLike("rate_limited", "Slow down"));
    expect(line).toContain("(rate_limited: Slow down)");
    expect(line).not.toContain("REDACTED");
  });

  it("handles non-Error throws", () => {
    expect(describeError("boom")).toBe("boom");
  });
});

describe("gmailApiId", () => {
  it("converts X-GM-MSGID to the Gmail API's hex id without losing precision", () => {
    // 64-bit ids are past Number's safe-integer range; a Number() conversion would corrupt the low digits.
    expect(gmailApiId("1278455344230334865")).toBe("11bdfc5cae0c8191");
    expect(gmailApiId("18446744073709551615")).toBe("ffffffffffffffff");
  });
});
