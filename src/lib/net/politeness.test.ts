import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAllowedByRobots } from "./politeness";

function mockRobotsTxt(text: string) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => text,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("isAllowedByRobots", () => {
  // Each test uses its own origin — getRobotsDisallow caches per-origin
  // with a TTL, so reusing one host across tests would silently serve an
  // earlier test's mocked robots.txt instead of the current one.

  it("allows a path with no matching disallow rule", async () => {
    mockRobotsTxt("User-agent: *\nDisallow: /admin/");
    await expect(isAllowedByRobots("https://host-a.example.com/feed.rss")).resolves.toBe(true);
  });

  it("blocks a plain literal-prefix disallow rule", async () => {
    mockRobotsTxt("User-agent: *\nDisallow: /admin/");
    await expect(isAllowedByRobots("https://host-b.example.com/admin/users")).resolves.toBe(false);
  });

  it("respects a wildcard + end-anchor rule (moneysavingexpert.com's real /*.rss$ rule)", async () => {
    mockRobotsTxt(
      "User-agent: Claude-User\nAllow: /\nUser-agent: *\nDisallow: /entry/\nDisallow: /*.rss$\nDisallow: /messages/",
    );
    await expect(isAllowedByRobots("https://host-c.example.com/categories/competitions/feed.rss")).resolves.toBe(
      false,
    );
    // The end-anchor means a path merely containing "rss" isn't blocked unless it ends there.
    await expect(isAllowedByRobots("https://host-c.example.com/rss-club/latest")).resolves.toBe(true);
  });

  it("only applies rules from the wildcard (*) group, not a named one", async () => {
    mockRobotsTxt("User-agent: Claude-User\nDisallow: /\nUser-agent: *\nAllow: /");
    await expect(isAllowedByRobots("https://host-d.example.com/anything")).resolves.toBe(true);
  });

  it("fails open when robots.txt can't be fetched", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    await expect(isAllowedByRobots("https://host-e.example.com/anything")).resolves.toBe(true);
  });
});
