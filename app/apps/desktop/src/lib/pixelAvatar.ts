/* ============================================================
   8-bit character avatars. A 16×16 pixel bust (hair or hat, face, shirt)
   chosen deterministically from a seed, with a thick dark outline in the
   classic sprite style. Pure SVG built on-device: no network, no ids, the
   same seed draws the same character on every machine.
   ============================================================ */

const N = 16;
type Grid = (string | null)[][];

const SKIN = ["#f5d6b8", "#eec4a0", "#d9a27a", "#a8704c", "#7a4e33"];
const HAIR = ["#1d1b1a", "#3b2a20", "#6b4226", "#a8642e", "#d9b25c", "#8a8a8a", "#c9472d"];
const SHIRT = ["#cfe8ff", "#e9579c", "#4b5563", "#2d8fd5", "#3fae6a", "#f2b632", "#a4693c", "#ff7e5f", "#4b5563"];
const HAT = ["#4b5563", "#2d3a8c", "#c9472d", "#1d1b1a", "#3fae6a", "#e9579c"];
const BG = ["#ffe4da", "#e3f0ff", "#e6f6ea", "#f1f1f2", "#fff4cc", "#e9eef2", "#ffe0ef"];
const OUTLINE = "#141414";

function hash(seed: string): number {
  // FNV-1a, then a mixing step so neighbouring seeds look unrelated.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

function picker(seed: string) {
  let state = hash(seed) || 1;
  return <T>(list: readonly T[]): T => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return list[state % list.length];
  };
}

function fill(g: Grid, r0: number, r1: number, c0: number, c1: number, color: string) {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && r < N && c >= 0 && c < N) g[r][c] = color;
}

const HAIR_STYLES = ["short", "long", "spiky", "bun", "wideHat", "cap", "bald", "bob"] as const;
const MOUTHS = ["none", "smile", "grin", "none"] as const;
const EXTRAS = ["none", "collar", "necklace", "glasses", "none", "stripe"] as const;

/** The grid itself, exported for tests. `null` = transparent. */
export function pixelGrid(seed: string): Grid {
  const pick = picker(seed);
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const shirt = pick(SHIRT);
  const hat = pick(HAT);
  const style = pick(HAIR_STYLES);
  const mouth = style === "bald" ? "grin" : pick(MOUTHS);
  const extra = pick(EXTRAS);
  const g: Grid = Array.from({ length: N }, () => Array<string | null>(N).fill(null));

  // Body and neck first, head over them.
  fill(g, 12, 15, 2, 13, shirt);
  fill(g, 11, 11, 6, 9, skin);
  fill(g, 4, 10, 4, 11, skin);

  switch (style) {
    case "short":
      fill(g, 2, 3, 4, 11, hair); fill(g, 4, 5, 4, 4, hair); fill(g, 4, 5, 11, 11, hair); fill(g, 1, 1, 6, 9, hair);
      break;
    case "long":
      fill(g, 1, 3, 5, 10, hair); fill(g, 2, 3, 4, 11, hair); fill(g, 3, 11, 3, 3, hair); fill(g, 3, 11, 12, 12, hair);
      fill(g, 4, 6, 4, 4, hair); fill(g, 4, 6, 11, 11, hair);
      break;
    case "spiky":
      for (const c of [4, 6, 8, 10]) fill(g, 1, 1, c, c, hair);
      fill(g, 2, 3, 4, 11, hair); fill(g, 4, 4, 4, 4, hair); fill(g, 4, 4, 11, 11, hair);
      break;
    case "bun":
      fill(g, 0, 1, 7, 8, hair); fill(g, 2, 3, 4, 11, hair); fill(g, 4, 5, 4, 4, hair); fill(g, 4, 5, 11, 11, hair);
      break;
    case "bob":
      fill(g, 1, 3, 4, 11, hair); fill(g, 3, 9, 3, 3, hair); fill(g, 3, 9, 12, 12, hair); fill(g, 4, 4, 4, 11, hair);
      break;
    case "wideHat":
      fill(g, 0, 2, 5, 10, hat); fill(g, 3, 3, 1, 14, OUTLINE); fill(g, 4, 4, 4, 4, hair); fill(g, 4, 4, 11, 11, hair);
      break;
    case "cap":
      fill(g, 1, 3, 4, 11, hat); fill(g, 3, 3, 11, 13, hat); fill(g, 4, 5, 4, 4, hair);
      break;
    case "bald":
      fill(g, 9, 10, 4, 11, hair); fill(g, 7, 8, 4, 4, hair); fill(g, 7, 8, 11, 11, hair); fill(g, 3, 3, 5, 10, skin);
      break;
  }

  // Eyes.
  g[7][6] = OUTLINE;
  g[7][9] = OUTLINE;
  if (extra === "glasses") {
    fill(g, 6, 6, 5, 7, OUTLINE); fill(g, 6, 6, 8, 10, OUTLINE);
  }
  // Mouth.
  if (mouth === "smile") { g[9][7] = "#e23a4e"; g[9][8] = "#e23a4e"; g[8][9] = style === "bald" ? g[8][9] : "#e23a4e"; }
  if (mouth === "grin") { fill(g, 9, 9, 6, 9, "#ffffff"); }

  // Shirt details.
  if (extra === "collar") { fill(g, 12, 12, 6, 9, OUTLINE); g[13][7] = OUTLINE; g[13][8] = OUTLINE; fill(g, 12, 12, 7, 8, skin); }
  if (extra === "necklace") { g[12][5] = "#c7d92b"; g[12][10] = "#c7d92b"; fill(g, 13, 13, 6, 9, "#c7d92b"); }
  if (extra === "stripe") fill(g, 14, 14, 2, 13, "#ffffff");

  // Thick sprite outline: every empty cell touching a filled one.
  const out: Grid = g.map((row) => row.slice());
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (g[r][c]) continue;
      const near = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([y, x]) => y >= 0 && y < N && x >= 0 && x < N && g[y][x] && g[y][x] !== OUTLINE);
      if (near) out[r][c] = OUTLINE;
    }
  }
  return out;
}

/** Background tint for a seed, separate from the sprite so callers can reuse it. */
export function pixelBackground(seed: string): string {
  return BG[hash(`${seed}#bg`) % BG.length];
}

/** The avatar as an SVG string: a round tinted tile with the sprite inside. */
export function pixelAvatarSvg(seed: string): string {
  const grid = pixelGrid(seed);
  const rects: string[] = [];
  for (let r = 0; r < N; r++) {
    let c = 0;
    while (c < N) {
      const color = grid[r][c];
      if (!color) { c++; continue; }
      let w = 1;
      while (c + w < N && grid[r][c + w] === color) w++;
      rects.push(`<rect x="${c + 2}" y="${r + 3}" width="${w}" height="1" fill="${color}"/>`);
      c += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" shape-rendering="crispEdges"><circle cx="10" cy="10" r="10" fill="${pixelBackground(seed)}" shape-rendering="geometricPrecision"/>${rects.join("")}</svg>`;
}
