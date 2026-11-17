import { describe, expect, it } from "vitest";
import { parseBillingLink } from "../billingLink";

describe("parseBillingLink", () => {
  it("accepts both foldings, with and without a vault", () => {
    expect(parseBillingLink("mav://billing/upgraded")).toEqual({ orgId: null });
    expect(parseBillingLink("mav:///billing/upgraded/")).toEqual({ orgId: null });
    expect(parseBillingLink("mav://billing/upgraded?org=WmpuI6BO")).toEqual({
      orgId: "WmpuI6BO",
    });
    expect(parseBillingLink("mav:///billing/upgraded?org=abc%2Fdef")).toEqual({
      orgId: "abc/def",
    });
  });

  it("accepts the Staging and dev builds' schemes too", () => {
    expect(parseBillingLink("mav-staging://billing/upgraded?org=x")).toEqual({ orgId: "x" });
    expect(parseBillingLink("mav-dev://billing/upgraded?org=x")).toEqual({ orgId: "x" });
  });

  it("treats an empty org as absent", () => {
    expect(parseBillingLink("mav://billing/upgraded?org=")).toEqual({ orgId: null });
    expect(parseBillingLink("mav://billing/upgraded?org=%20")).toEqual({ orgId: null });
  });

  it("refuses anything else", () => {
    for (const bad of [
      "mav://billing",
      "mav://billing/canceled",
      "mav://billing/upgraded/extra",
      "mav://upgraded",
      "mav://verified",
      "https://example.com/billing/upgraded",
      "not a url",
      "mav://",
    ]) {
      expect(parseBillingLink(bad)).toBeNull();
    }
  });
});
