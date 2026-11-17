// Slash-command block menu. Type `/` at the start of a line to open a menu of
// block templates (headings, lists, tasks, quote, code, table, divider). It
// reuses CodeMirror's autocomplete surface, so it looks and keys like the
// `[[wiki-link]]` menu. Each option replaces the `/query` it was triggered from
// with the block's markdown and parks the caret where you'd start typing.

import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Build an `apply` that replaces the trigger with `insert`, caret at `caret`
 *  (offset from the insert start) or selecting [selFrom, selTo). */
function applyBlock(
  insert: string,
  caret: number,
  selTo?: number
): (view: EditorView, c: Completion, from: number, to: number) => void {
  return (view, _c, from, to) => {
    view.dispatch({
      changes: { from, to, insert },
      selection:
        selTo != null
          ? EditorSelection.range(from + caret, from + selTo)
          : EditorSelection.cursor(from + caret),
      scrollIntoView: true,
      userEvent: "input.complete",
    });
  };
}

interface Block {
  label: string;
  detail: string;
  keywords: string;
  insert: string;
  caret: number;
  selTo?: number;
}

const BLOCKS: Block[] = [
  { label: "제목 1", detail: "#", keywords: "h1 title heading 제목", insert: "# ", caret: 2 },
  { label: "제목 2", detail: "##", keywords: "h2 heading 제목", insert: "## ", caret: 3 },
  { label: "제목 3", detail: "###", keywords: "h3 heading 제목", insert: "### ", caret: 4 },
  { label: "글머리 기호 목록", detail: "-", keywords: "ul unordered bullet list 목록", insert: "- ", caret: 2 },
  { label: "번호 목록", detail: "1.", keywords: "ol ordered numbered list 목록", insert: "1. ", caret: 3 },
  { label: "할 일", detail: "- [ ]", keywords: "task todo checkbox 체크박스", insert: "- [ ] ", caret: 6 },
  { label: "인용", detail: ">", keywords: "quote blockquote 인용문", insert: "> ", caret: 2 },
  {
    label: "코드 블록",
    detail: "```",
    keywords: "code block fence pre 코드",
    insert: "```\n\n```",
    caret: 4, // inside the fences (after "```\n")
  },
  {
    label: "다이어그램",
    detail: "mermaid",
    keywords: "diagram mermaid flowchart chart graph sequence 도표",
    insert: "```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```",
    caret: 11, // on the first body line, just after "```mermaid\n"
  },
  {
    label: "표",
    detail: "columns",
    keywords: "table grid 테이블",
    insert: "| 열 | 열 |\n| --- | --- |\n|  |  |",
    caret: 2, // select the first header cell
    selTo: 3,
  },
  { label: "구분선", detail: "---", keywords: "divider hr rule separator 줄", insert: "---\n", caret: 4 },
];

const COMPLETIONS: Completion[] = BLOCKS.map((b) => ({
  label: `/${b.label}`,
  detail: b.detail,
  type: "keyword",
  apply: applyBlock(b.insert, b.caret, b.selTo),
}));

/** Completion source: only fires for a `/…` that begins a line. */
export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\/\w*/);
  if (!before) return null;
  // The `/` must be the first non-space char on the line (a block trigger),
  // not a slash mid-sentence (dates, paths, "and/or").
  const line = context.state.doc.lineAt(before.from);
  if (before.from !== line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0)) {
    return null;
  }
  if (before.from === before.to && !context.explicit) return null;

  const typed = before.text.slice(1).toLowerCase();
  const options = COMPLETIONS.filter((_, i) => {
    if (!typed) return true;
    const b = BLOCKS[i];
    return (
      b.label.toLowerCase().includes(typed) || b.keywords.includes(typed)
    );
  });

  return { from: before.from, to: before.to, options, filter: false };
}
