import { describe, expect, it } from "vitest";
import { accessLevelClass, audienceLine, myAccessOf, personAccessOptions } from "../access";

const aud = (count: number, total: number) => ({ everyone: count === total, count, total, people: [] });

describe("skill access helpers", () => {
  it("says who has a skill in a few words", () => {
    expect(audienceLine(aud(6, 6), true)).toBe("모든 멤버 · 6명");
    expect(audienceLine(aud(0, 6), false)).toBe("아직 없음");
    expect(audienceLine(aud(1, 6), true)).toBe("나만");
    expect(audienceLine(aud(2, 6), true)).toBe("나 외 1명");
    expect(audienceLine(aud(3, 6), true)).toBe("나 외 2명");
    expect(audienceLine(aud(3, 6), false)).toBe("3명");
    expect(audienceLine(aud(1, 6), false)).toBe("1명");
  });

  it("falls back to the delivery on a server without per-person access", () => {
    expect(myAccessOf({ delivery: "optional" })).toBe("optional");
    expect(myAccessOf({ delivery: "required", myAccess: "none" })).toBe("none");
  });

  it("offers Same as everyone only to someone with their own setting, naming the level", () => {
    expect(personAccessOptions(false, "required").map((o) => o.value)).toEqual(["required", "optional", "none"]);
    const own = personAccessOptions(true, "optional");
    expect(own[own.length - 1]).toMatchObject({ value: "everyone", label: "모든 멤버와 동일 (선택)" });
  });

  it("colours levels like vault access", () => {
    expect([accessLevelClass("required"), accessLevelClass("optional"), accessLevelClass("none")]).toEqual(["is-edit", "is-view", "is-none"]);
  });
});
