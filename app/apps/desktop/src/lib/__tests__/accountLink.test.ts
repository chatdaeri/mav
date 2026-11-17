import { describe, expect, it } from "vitest";
import { parseAccountLink } from "../accountLink";
import { ApiError } from "../api";
import { passwordResetFailureMessage } from "../resetFlow";

describe("parseAccountLink", () => {
  it("accepts both foldings of the two links", () => {
    expect(parseAccountLink("mav://verified")).toBe("verified");
    expect(parseAccountLink("mav:///verified")).toBe("verified");
    expect(parseAccountLink("mav://signin")).toBe("signin");
    expect(parseAccountLink("mav:///signin/")).toBe("signin");
  });

  it("accepts the Staging app's scheme too", () => {
    expect(parseAccountLink("mav-staging://verified")).toBe("verified");
  });

  it("refuses anything else", () => {
    for (const bad of [
      "mav://verified/extra",
      "mav://invite/abc",
      "https://example.com/verified",
      "not a url",
      "mav://",
    ]) {
      expect(parseAccountLink(bad)).toBeNull();
    }
  });
});

describe("passwordResetFailureMessage", () => {
  const ctx = { email: "a@x.io", serverHost: "notes.example.com" };

  it("names the server when there is no account", () => {
    const msg = passwordResetFailureMessage(new ApiError(404, "no_account", { error: "no_account" }), ctx);
    expect(msg).toContain("a@x.io");
    expect(msg).toContain("notes.example.com");
  });

  it("carries the provider's reason on a send failure", () => {
    const msg = passwordResetFailureMessage(
      new ApiError(502, "send_failed", { error: "send_failed", message: "The mail provider refused the message: 550" }),
      ctx,
    );
    expect(msg).toContain("재설정 이메일을 보내지 못했어요");
    expect(msg).toContain("550");
  });

  it("falls back to the error's own message", () => {
    expect(passwordResetFailureMessage(new Error("Load failed"), ctx)).toBe("Load failed");
  });
});
