// Where a clicked Markdown link `[text](target)` goes.
//
// 마브 vaults (the Synergy Labs second brain first among them) link notes and
// files with plain Markdown links whose target is a path RELATIVE to the note:
// `[목차](<콘텐츠/content.md>)`, `[원본](../원본/보고서.pdf)`, `[폴더](원본/)`.
// Baalda only knew `[[wikilinks]]` and sent every Markdown link to the OS
// browser, which cannot open a vault path. This decides, purely:
//   - a URL with a scheme (https:, mailto:, …)     → open externally
//   - `file:` URLs and absolute paths              → inside the vault: open in
//     the app; outside: hand to the OS (Finder / default app)
//   - anything else                                → a path relative to the
//     note's folder, resolved inside the vault
// Folders (a trailing `/`, or a last segment with no extension) are revealed in
// the sidebar rather than opened.

export type MdLinkAction =
  | { kind: "external"; url: string }
  | { kind: "os-path"; path: string }
  | { kind: "open"; path: string }
  | { kind: "reveal"; path: string }
  | { kind: "none" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Normalise `a/./b/../c` → `a/c`. `null` if it climbs above the root. */
export function normalizeRelPath(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}

function looksLikeFolder(raw: string, path: string): boolean {
  if (raw.endsWith("/")) return true;
  const last = path.split("/").pop() ?? "";
  return !/\.[^./]+$/.test(last);
}

/**
 * @param href        the link target as written (angle brackets allowed)
 * @param fromNote    vault-relative path of the note holding the link
 * @param vaultRoot   absolute path of the vault folder (for absolute links)
 */
export function mdLinkAction(
  href: string,
  fromNote: string | null,
  vaultRoot: string | null,
): MdLinkAction {
  let raw = href.trim();
  if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1).trim();
  if (!raw) return { kind: "none" };
  if (raw.startsWith("#")) return { kind: "none" }; // same-note heading

  if (SCHEME.test(raw) && !/^file:/i.test(raw)) {
    // A Windows drive path (`C:\…`, `C:/…`) also matches the scheme pattern.
    if (!/^[a-z]:[\\/]/i.test(raw)) return { kind: "external", url: raw };
  }

  let target = raw.replace(/[?#].*$/, "");
  if (/^file:/i.test(target)) {
    target = decode(target.replace(/^file:\/\//i, ""));
  } else {
    target = decode(target);
  }

  const isAbsolute = target.startsWith("/") || /^[a-z]:[\\/]/i.test(target);
  if (isAbsolute) {
    const root = vaultRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
    const abs = target.replace(/\\/g, "/");
    if (root && abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      const rel = normalizeRelPath(abs.slice(root.length + 1));
      if (!rel) return { kind: "none" };
      return looksLikeFolder(raw, rel) ? { kind: "reveal", path: rel } : { kind: "open", path: rel };
    }
    return { kind: "os-path", path: target };
  }

  const dir = fromNote && fromNote.includes("/") ? fromNote.slice(0, fromNote.lastIndexOf("/")) : "";
  const rel = normalizeRelPath(dir ? `${dir}/${target}` : target);
  if (rel === null) return { kind: "none" };
  if (rel === "") return { kind: "reveal", path: "" };
  return looksLikeFolder(raw, rel) ? { kind: "reveal", path: rel } : { kind: "open", path: rel };
}
