// 마브: the right-click menu on a Markdown link, in the editor, a table cell
// or the side pane. Opened by `requestLinkMenu` (lib/editor/linkEvents.ts).

import { useEffect, useState } from "react";
import { linkAction, openMdLink, type LinkTarget } from "../lib/editor/openMdLink";

interface MenuState {
  href: string;
  from: string | null;
  x: number;
  y: number;
}

export function LinkContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setMenu((e as CustomEvent<MenuState>).detail);
    window.addEventListener("mav-link-menu", onOpen);
    return () => window.removeEventListener("mav-link-menu", onOpen);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  if (!menu) return null;
  const action = linkAction(menu.href, menu.from);
  const run = (target: LinkTarget) => {
    const m = menu;
    setMenu(null);
    void openMdLink(m.href, { from: m.from, target });
  };
  const copy = () => {
    setMenu(null);
    void navigator.clipboard?.writeText(action.kind === "open" ? action.path : menu.href);
  };

  const items: { label: string; onSelect: () => void }[] =
    action.kind === "open"
      ? [
          { label: "옆 창에서 열기", onSelect: () => run("split") },
          { label: "지금 탭에서 열기", onSelect: () => run("current") },
          { label: "새 탭에서 열기", onSelect: () => run("tab") },
          { label: "경로 복사", onSelect: copy },
        ]
      : [
          { label: action.kind === "reveal" ? "사이드바에서 보기" : "열기", onSelect: () => run("split") },
          { label: "링크 복사", onSelect: copy },
        ];

  // Keep the menu on screen near the right/bottom edges.
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - items.length * 34 - 16);

  return (
    <div
      className="link-context-menu"
      role="menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" onClick={it.onSelect}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
