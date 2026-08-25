import { describe, it, expect } from "vitest";
import { isSafeExternalUrl, isPrivateOrLocalHost } from "./ssrf";

describe("isPrivateOrLocalHost", () => {
  it.each([
    "localhost",
    "printer.local",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata endpoint
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("flags %s as private/local", (host) => {
    expect(isPrivateOrLocalHost(host)).toBe(true);
  });

  it.each(["example.com", "sponsor.example.co.uk", "8.8.8.8", "172.32.0.1", "172.15.0.1"])(
    "does not flag %s",
    (host) => {
      expect(isPrivateOrLocalHost(host)).toBe(false);
    },
  );
});

describe("isSafeExternalUrl", () => {
  it("allows a normal public https URL", () => {
    expect(isSafeExternalUrl("https://sponsor.example.com/win")).toBe(true);
  });

  it("rejects a URL pointing at localhost", () => {
    expect(isSafeExternalUrl("http://localhost:3000/admin")).toBe(false);
  });

  it("rejects a URL pointing at a private IP (e.g. a home router)", () => {
    expect(isSafeExternalUrl("http://192.168.1.1/")).toBe(false);
  });

  it("rejects the cloud metadata endpoint address", () => {
    expect(isSafeExternalUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
