// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardTemplateGallery } from "../DashboardTemplateGallery";
import { DASHBOARD_TEMPLATES } from "../../lib/dashboard/templates";

vi.mock("../VaultDashboardPreview", () => ({ VaultDashboardPreview: ({ path }: { path: string }) => createElement("iframe", { title:path }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting:true }]); }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("lists all templates as lazy images without starting dashboard scripts, then mounts only the clicked preview", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(DashboardTemplateGallery, { onUse:vi.fn() })));
  expect(host.querySelectorAll("img[loading='lazy']")).toHaveLength(DASHBOARD_TEMPLATES.length);
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="기본 대시보드 미리보기"]')!.click());
  expect(host.querySelectorAll("iframe")).toHaveLength(1);
  expect(host.querySelector("iframe")?.title).toBe("기본 대시보드 미리보기");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "← 모든 템플릿")!.click());
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
});

it("opens the saved dashboard only on click while retaining the static card and Current Home label", async () => {
  const onOpen = vi.fn(), onUnset = vi.fn();
  await act(async () => root.render(createElement(DashboardTemplateGallery, { onUse:vi.fn(), saved:{"mav-overview":"My dashboard.html"}, currentId:"mav-overview", onOpen, onUnset })));
  expect(host.textContent).toContain("현재 대시보드");
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="기본 대시보드 미리보기"]')!.click());
  expect(host.querySelector("iframe")?.title).toBe("My dashboard.html");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "열기")!.click());
  expect(onOpen).toHaveBeenCalledWith("My dashboard.html");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "대시보드 해제")!.click());
  expect(onUnset).toHaveBeenCalledOnce();
});
