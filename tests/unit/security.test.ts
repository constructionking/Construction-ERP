import { describe, it, expect } from "vitest";
import { backoffMs, evaluateAccountLock, ACCOUNT_FAILURE_THRESHOLD } from "@/lib/auth/lockout";
import { sniffImage, isXlsxBytes, verifiedImageType } from "@/lib/uploads";
import { validatePassword } from "@/lib/auth/password";

describe("brute-force backoff", () => {
  it("no lock below the threshold", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(ACCOUNT_FAILURE_THRESHOLD - 1)).toBe(0);
  });

  it("exponential from the threshold, capped at 30 minutes", () => {
    expect(backoffMs(5)).toBe(60_000); // 1 min
    expect(backoffMs(6)).toBe(120_000); // 2 min
    expect(backoffMs(7)).toBe(240_000); // 4 min
    expect(backoffMs(10)).toBe(30 * 60_000); // capped
    expect(backoffMs(50)).toBe(30 * 60_000);
  });
});

describe("account lock evaluation", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);
  const fail = (secondsAgo: number) => ({ success: false, createdAt: at(secondsAgo) });
  const ok = (secondsAgo: number) => ({ success: true, createdAt: at(secondsAgo) });

  it("4 failures → not locked", () => {
    const result = evaluateAccountLock([fail(10), fail(20), fail(30), fail(40)], now);
    expect(result.locked).toBe(false);
  });

  it("5 fresh failures → locked ~1 minute", () => {
    const result = evaluateAccountLock([fail(5), fail(10), fail(15), fail(20), fail(25)], now);
    expect(result.locked).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("a success RESETS the consecutive count", () => {
    const result = evaluateAccountLock(
      [fail(5), fail(10), ok(15), fail(20), fail(25), fail(30), fail(35)],
      now
    );
    expect(result.locked).toBe(false); // only 2 failures since the success
  });

  it("lock expires after the backoff window", () => {
    const stale = [fail(120), fail(125), fail(130), fail(135), fail(140)]; // 5 fails, 2min ago
    expect(evaluateAccountLock(stale, now).locked).toBe(false); // 1-min lock already over
  });
});

describe("upload magic-byte sniffing", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP"),
  ]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const script = Buffer.from("#!/bin/sh\nrm -rf /\n and padding to exceed twelve bytes");
  const html = Buffer.from("<script>alert(1)</script> padding padding");

  it("recognizes real image formats", () => {
    expect(sniffImage(jpeg)).toBe("image/jpeg");
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(webp)).toBe("image/webp");
  });

  it("rejects scripts/HTML disguised as images", () => {
    expect(verifiedImageType(script)).toBeNull();
    expect(verifiedImageType(html)).toBeNull();
    expect(verifiedImageType(zip)).toBeNull(); // a zip is not an image
  });

  it("xlsx must be a ZIP container", () => {
    expect(isXlsxBytes(zip)).toBe(true);
    expect(isXlsxBytes(script)).toBe(false);
    expect(isXlsxBytes(jpeg)).toBe(false);
  });

  it("tiny buffers are rejected", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe("password policy", () => {
  it("rejects short, common, repeated and sequential passwords", () => {
    expect(validatePassword("short1")).not.toBeNull();
    expect(validatePassword("password123")).not.toBeNull();
    expect(validatePassword("aaaaaaaaaaaa")).not.toBeNull();
    expect(validatePassword("1234567890")).not.toBeNull();
    expect(validatePassword("qwertyuiop99")).not.toBeNull();
  });

  it("accepts a reasonable strong password", () => {
    expect(validatePassword("SunriseHts#2026")).toBeNull();
    expect(validatePassword("kaam-chalu-hai-77")).toBeNull();
  });
});
