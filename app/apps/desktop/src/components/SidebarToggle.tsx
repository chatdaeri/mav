// SPDX-License-Identifier: Apache-2.0

import { GraphButton } from "./GraphButton";

/** Window-chrome control for showing and hiding the vault sidebar. */
export function SidebarToggle({
  hidden,
  onToggle,
  searchOpen,
  onSearch,
  onGraph,
}: {
  hidden: boolean;
  onToggle: () => void;
  searchOpen: boolean;
  onSearch: () => void;
  onGraph?: () => void;
}) {
  return (
    <div className="titlebar-tools">
      <button
        type="button"
        className="titlebar-tool sidebar-toggle"
        aria-label={hidden ? "사이드바 보기" : "사이드바 숨기기"}
        aria-controls="vault-sidebar"
        aria-expanded={!hidden}
        title={hidden ? "사이드바 보기" : "사이드바 숨기기"}
        onClick={onToggle}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M9 5v14" />
        </svg>
      </button>
      <button
        type="button"
        className="titlebar-tool titlebar-search"
        title={document.documentElement.dataset.platform === "windows" ? "노트 검색 (Ctrl+F)" : "노트 검색 (⌘F)"}
        aria-label="노트 검색"
        aria-pressed={searchOpen}
        onClick={onSearch}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      {onGraph && <GraphButton titlebar onClick={onGraph} />}
    </div>
  );
}
