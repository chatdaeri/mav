// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { requestLinkMenu, splitPathOf } from "./linkEvents";

describe("linkEvents", () => {
  it("finds the side-pane file a click happened in", () => {
    document.body.innerHTML = '<section data-split-path="콘텐츠/content.md"><p><a id="in">x</a></p></section><a id="out">y</a>';
    expect(splitPathOf(document.getElementById("in"))).toBe("콘텐츠/content.md");
    expect(splitPathOf(document.getElementById("out"))).toBeNull();
    expect(splitPathOf(null)).toBeNull();
  });

  it("broadcasts a link menu request", () => {
    const seen = vi.fn();
    window.addEventListener("mav-link-menu", (e) => seen((e as CustomEvent).detail));
    requestLinkMenu("<a.md>", "b.md", 10, 20);
    expect(seen).toHaveBeenCalledWith({ href: "<a.md>", from: "b.md", x: 10, y: 20 });
  });
});
