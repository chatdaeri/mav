//! Read-only previews of HWPX documents and PPTX decks.
//!
//! Both formats are zips of XML, so this reuses `extract.rs`'s bomb-guarded
//! archive helpers and returns a small STRUCTURED model (paragraphs, tables,
//! images, positioned slide shapes) — never HTML. React renders the model, so
//! every string from the file reaches the DOM as escaped text, and the only
//! URLs it can carry are `data:image/...;base64` pictures built here from the
//! file's own media entries.
//!
//! Fidelity is deliberately partial: text, tables, pictures and (for slides)
//! box positions. Fonts, colours, themes, master/layout backgrounds, charts and
//! vector shapes are not drawn; the viewer says so and offers the real app.

use crate::extract::{open_archive, parts_in_order, read_entry, Archive, MAX_ZIP_ENTRY_BYTES};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;

/// The file itself, read whole (the `zip` crate needs `Seek`).
pub const MAX_PREVIEW_INPUT_BYTES: u64 = 60 * 1024 * 1024;
/// One picture is inlined only below this; larger ones are counted as skipped.
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
/// Sum of inlined picture bytes per preview (base64 inflates by a third).
const MAX_TOTAL_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
/// Text budget per preview, in chars.
const MAX_TEXT_CHARS: usize = 1_000_000;
const MAX_SLIDES: usize = 500;
/// Nesting / node guards for the tree parser: hostile XML can be deep or huge.
const MAX_DEPTH: usize = 200;
const MAX_NODES: usize = 400_000;

// ---- model ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    #[serde(rename_all = "camelCase")]
    Para {
        text: String,
        bold: bool,
        /// Point size, when the file states one.
        size: Option<f32>,
        /// `left` | `center` | `right` | `justify`.
        align: Option<String>,
    },
    Table {
        rows: Vec<Vec<Cell>>,
    },
    Image {
        src: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub blocks: Vec<Block>,
    pub colspan: u32,
    pub rowspan: u32,
}

/// One box on a slide. Position and size are FRACTIONS of the slide (0..1);
/// `None` when the box inherits its frame from a layout we do not read.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    pub shapes: Vec<Shape>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfficePreview {
    /// `document` (HWPX) or `slides` (PPTX).
    pub kind: &'static str,
    pub blocks: Vec<Block>,
    pub slides: Vec<Slide>,
    /// Slide width in points, for scaling font sizes (PPTX only).
    pub slide_width_pt: Option<f64>,
    /// Slide width / height (PPTX only).
    pub aspect: Option<f64>,
    /// Pictures left out (too big, unsupported format such as EMF/WMF).
    pub skipped_images: u32,
    /// Text or slides were cut at a budget.
    pub truncated: bool,
}

/// Why a preview could not be built. Rendered by the viewer as a file card.
#[derive(Debug, Clone, PartialEq)]
pub enum PreviewError {
    TooLarge,
    Unreadable,
    Unsupported,
}

impl std::fmt::Display for PreviewError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreviewError::TooLarge => write!(f, "preview_too_large"),
            PreviewError::Unreadable => write!(f, "preview_unreadable"),
            PreviewError::Unsupported => write!(f, "preview_unsupported"),
        }
    }
}

/// Build the preview for a lowercase, dotless extension. Never panics: every
/// parser runs inside `catch_unwind`, like `extract.rs`.
pub fn build_preview(ext: &str, bytes: &[u8]) -> Result<OfficePreview, PreviewError> {
    if bytes.len() as u64 > MAX_PREVIEW_INPUT_BYTES {
        return Err(PreviewError::TooLarge);
    }
    let run = || match ext {
        "hwpx" => hwpx_preview(bytes),
        "pptx" => pptx_preview(bytes),
        _ => Err(PreviewError::Unsupported),
    };
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(run)) {
        Ok(result) => result,
        Err(_) => Err(PreviewError::Unreadable),
    }
}

// ---- a tiny XML tree ----------------------------------------------------------

#[derive(Debug, Default)]
struct El {
    /// Local name (namespace prefix dropped).
    name: String,
    /// Local attribute names → unescaped values.
    attrs: Vec<(String, String)>,
    children: Vec<Node>,
}

#[derive(Debug)]
enum Node {
    El(El),
    Text(String),
}

impl El {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn elements(&self) -> impl Iterator<Item = &El> {
        self.children.iter().filter_map(|n| match n {
            Node::El(e) => Some(e),
            Node::Text(_) => None,
        })
    }
    fn child(&self, name: &str) -> Option<&El> {
        self.elements().find(|e| e.name == name)
    }
    fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a El> + 'a {
        self.elements().filter(move |e| e.name == name)
    }
    /// First descendant (depth-first) with this name.
    fn find(&self, name: &str) -> Option<&El> {
        for e in self.elements() {
            if e.name == name {
                return Some(e);
            }
            if let Some(found) = e.find(name) {
                return Some(found);
            }
        }
        None
    }
}

fn local(name: &[u8]) -> String {
    let s = String::from_utf8_lossy(name);
    match s.rsplit_once(':') {
        Some((_, l)) => l.to_string(),
        None => s.into_owned(),
    }
}

fn element_from(e: &quick_xml::events::BytesStart<'_>) -> El {
    let mut el = El {
        name: local(e.local_name().as_ref()),
        ..Default::default()
    };
    for a in e.attributes().flatten() {
        let key = local(a.key.as_ref());
        let value = a
            .unescape_value()
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
        el.attrs.push((key, value));
    }
    el
}

/// Parse a whole part into a tree. A malformed tail keeps what came before it,
/// like `extract.rs`; depth and node count are capped.
fn parse_tree(xml: &str) -> El {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut stack: Vec<El> = vec![El::default()];
    let mut nodes = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                nodes += 1;
                if stack.len() > MAX_DEPTH || nodes > MAX_NODES {
                    break;
                }
                stack.push(element_from(&e));
            }
            Ok(Event::Empty(e)) => {
                nodes += 1;
                if nodes > MAX_NODES {
                    break;
                }
                let el = element_from(&e);
                if let Some(top) = stack.last_mut() {
                    top.children.push(Node::El(el));
                }
            }
            Ok(Event::End(_)) => {
                if stack.len() > 1 {
                    let done = stack.pop().unwrap();
                    stack.last_mut().unwrap().children.push(Node::El(done));
                }
            }
            Ok(Event::Text(t)) => {
                let text = t.unescape().map(|c| c.into_owned()).unwrap_or_default();
                if !text.is_empty() {
                    if let Some(top) = stack.last_mut() {
                        top.children.push(Node::Text(text));
                    }
                }
            }
            Ok(Event::CData(t)) => {
                let text = String::from_utf8_lossy(&t).into_owned();
                if let Some(top) = stack.last_mut() {
                    top.children.push(Node::Text(text));
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    // Close whatever a truncated part left open.
    while stack.len() > 1 {
        let done = stack.pop().unwrap();
        stack.last_mut().unwrap().children.push(Node::El(done));
    }
    stack.pop().unwrap()
}

// ---- shared budgets & pictures ------------------------------------------------

struct Budget {
    chars: usize,
    image_bytes: u64,
    skipped_images: u32,
    truncated: bool,
}

impl Budget {
    fn new() -> Self {
        Budget {
            chars: 0,
            image_bytes: 0,
            skipped_images: 0,
            truncated: false,
        }
    }
    /// Charge `text`; returns false once the text budget is spent.
    fn take_text(&mut self, text: &str) -> bool {
        if self.chars >= MAX_TEXT_CHARS {
            self.truncated = true;
            return false;
        }
        self.chars += text.chars().count();
        true
    }
}

fn image_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        // EMF/WMF/TIFF/SVG: no safe in-webview renderer; counted as skipped.
        _ => None,
    }
}

/// A media entry as a data URL, or `None` (counted) when it cannot be shown.
fn picture(zip: &mut Archive<'_>, entry: &str, budget: &mut Budget) -> Option<Block> {
    let Some(mime) = image_mime(entry) else {
        budget.skipped_images += 1;
        return None;
    };
    let size = match zip.by_name(entry) {
        Ok(f) => f.size(),
        Err(_) => {
            budget.skipped_images += 1;
            return None;
        }
    };
    if size > MAX_IMAGE_BYTES || budget.image_bytes + size > MAX_TOTAL_IMAGE_BYTES {
        budget.skipped_images += 1;
        return None;
    }
    let mut bytes = Vec::with_capacity(size as usize);
    let ok = zip
        .by_name(entry)
        .ok()
        .map(|f| f.take(MAX_ZIP_ENTRY_BYTES.min(MAX_IMAGE_BYTES)).read_to_end(&mut bytes).is_ok())
        .unwrap_or(false);
    if !ok {
        budget.skipped_images += 1;
        return None;
    }
    budget.image_bytes += bytes.len() as u64;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(Block::Image {
        src: format!("data:{mime};base64,{b64}"),
    })
}

/// `a/b/../c` → `a/c`, `./x` → `x`. Leading `/` (absolute target) is dropped.
fn normalize_zip_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn span(v: Option<&str>) -> u32 {
    v.and_then(|s| s.parse::<u32>().ok()).filter(|n| *n >= 1).unwrap_or(1).min(1000)
}

// ---- HWPX -------------------------------------------------------------------

fn hwpx_preview(bytes: &[u8]) -> Result<OfficePreview, PreviewError> {
    let mut zip = open_archive(bytes).map_err(|_| PreviewError::Unreadable)?;
    let sections = parts_in_order(&zip, "Contents/section", ".xml");
    if sections.is_empty() {
        return Err(PreviewError::Unreadable);
    }
    let images = hwpx_image_map(&mut zip);
    let mut budget = Budget::new();
    let mut blocks = Vec::new();
    for name in sections {
        let Some(xml) = read_entry(&mut zip, &name) else {
            continue;
        };
        let root = parse_tree(&xml);
        // The root holds `<hs:sec>`; its children are the paragraphs.
        let sec = root.elements().next();
        if let Some(sec) = sec {
            hwpx_paragraphs(sec, &mut zip, &images, &mut budget, &mut blocks);
        }
        if budget.truncated {
            break;
        }
    }
    Ok(OfficePreview {
        kind: "document",
        blocks,
        slides: Vec::new(),
        slide_width_pt: None,
        aspect: None,
        skipped_images: budget.skipped_images,
        truncated: budget.truncated,
    })
}

/// `binaryItemIDRef` → zip entry, from the package manifest
/// (`Contents/content.hpf`), falling back to `BinData/<id>.*`.
fn hwpx_image_map(zip: &mut Archive<'_>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(hpf) = read_entry(zip, "Contents/content.hpf") {
        let root = parse_tree(&hpf);
        if let Some(manifest) = root.find("manifest") {
            for item in manifest.children_named("item") {
                if let (Some(id), Some(href)) = (item.attr("id"), item.attr("href")) {
                    map.insert(id.to_string(), normalize_zip_path(href));
                }
            }
        }
    }
    let names: Vec<String> = zip
        .file_names()
        .filter(|n| n.starts_with("BinData/"))
        .map(|n| n.to_string())
        .collect();
    for n in names {
        let stem = n
            .trim_start_matches("BinData/")
            .split('.')
            .next()
            .unwrap_or("")
            .to_string();
        map.entry(stem).or_insert(n);
    }
    map
}

/// Walk the `<hp:p>` children of a section or `<hp:subList>`.
fn hwpx_paragraphs(
    parent: &El,
    zip: &mut Archive<'_>,
    images: &HashMap<String, String>,
    budget: &mut Budget,
    out: &mut Vec<Block>,
) {
    for p in parent.children_named("p") {
        if budget.truncated {
            return;
        }
        let mut text = String::new();
        hwpx_inline(p, zip, images, budget, out, &mut text);
        push_para(out, &mut text, false, None, None, budget);
    }
}

/// Collect a paragraph's text, emitting tables, pictures and text-box contents
/// as their own blocks at the point they occur.
fn hwpx_inline(
    el: &El,
    zip: &mut Archive<'_>,
    images: &HashMap<String, String>,
    budget: &mut Budget,
    out: &mut Vec<Block>,
    text: &mut String,
) {
    for node in &el.children {
        let Node::El(child) = node else { continue };
        match child.name.as_str() {
            "t" => {
                for n in &child.children {
                    match n {
                        Node::Text(s) => text.push_str(s),
                        Node::El(e) if e.name == "tab" => text.push('\t'),
                        Node::El(e) if e.name == "lineBreak" => text.push('\n'),
                        Node::El(e) if e.name == "nbSpace" || e.name == "fwSpace" => {
                            text.push(' ')
                        }
                        _ => {}
                    }
                }
            }
            "tbl" => {
                push_para(out, text, false, None, None, budget);
                let mut rows = Vec::new();
                for tr in child.children_named("tr") {
                    let mut cells = Vec::new();
                    for tc in tr.children_named("tc") {
                        let mut blocks = Vec::new();
                        if let Some(sub) = tc.child("subList") {
                            hwpx_paragraphs(sub, zip, images, budget, &mut blocks);
                        }
                        let cs = tc.child("cellSpan");
                        cells.push(Cell {
                            blocks,
                            colspan: span(cs.and_then(|c| c.attr("colSpan"))),
                            rowspan: span(cs.and_then(|c| c.attr("rowSpan"))),
                        });
                    }
                    rows.push(cells);
                }
                out.push(Block::Table { rows });
            }
            "pic" => {
                push_para(out, text, false, None, None, budget);
                let id = child.find("img").and_then(|i| i.attr("binaryItemIDRef"));
                match id.and_then(|id| images.get(id)).cloned() {
                    Some(entry) => {
                        if let Some(img) = picture(zip, &entry, budget) {
                            out.push(img);
                        }
                    }
                    None => budget.skipped_images += 1,
                }
            }
            // Section/column settings, field codes, headers/footers: no text body.
            "secPr" | "ctrl" | "linesegarray" => {}
            "run" => hwpx_inline(child, zip, images, budget, out, text),
            // Text boxes and other drawing objects carry a `<hp:drawText>` body.
            _ => {
                if let Some(sub) = child.child("drawText").and_then(|d| d.child("subList")) {
                    push_para(out, text, false, None, None, budget);
                    hwpx_paragraphs(sub, zip, images, budget, out);
                } else {
                    hwpx_inline(child, zip, images, budget, out, text);
                }
            }
        }
    }
}

fn push_para(
    out: &mut Vec<Block>,
    text: &mut String,
    bold: bool,
    size: Option<f32>,
    align: Option<String>,
    budget: &mut Budget,
) {
    let trimmed = text.trim_end_matches(['\n', ' ', '\t']);
    if !trimmed.is_empty() && budget.take_text(trimmed) {
        out.push(Block::Para {
            text: trimmed.to_string(),
            bold,
            size,
            align,
        });
    }
    text.clear();
}

// ---- PPTX -------------------------------------------------------------------

const EMU_PER_PT: f64 = 12_700.0;

fn rels_map(zip: &mut Archive<'_>, rels_path: &str, base_dir: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(xml) = read_entry(zip, rels_path) else {
        return map;
    };
    let root = parse_tree(&xml);
    if let Some(rels) = root.find("Relationships") {
        for r in rels.children_named("Relationship") {
            if r.attr("TargetMode") == Some("External") {
                continue;
            }
            if let (Some(id), Some(target)) = (r.attr("Id"), r.attr("Target")) {
                let joined = if target.starts_with('/') {
                    target.to_string()
                } else {
                    format!("{base_dir}/{target}")
                };
                map.insert(id.to_string(), normalize_zip_path(&joined));
            }
        }
    }
    map
}

fn pptx_preview(bytes: &[u8]) -> Result<OfficePreview, PreviewError> {
    let mut zip = open_archive(bytes).map_err(|_| PreviewError::Unreadable)?;
    let pres_xml = read_entry(&mut zip, "ppt/presentation.xml").ok_or(PreviewError::Unreadable)?;
    let pres = parse_tree(&pres_xml);
    let (cx, cy) = pres
        .find("sldSz")
        .and_then(|s| {
            Some((
                s.attr("cx")?.parse::<f64>().ok()?,
                s.attr("cy")?.parse::<f64>().ok()?,
            ))
        })
        .filter(|(x, y)| *x > 0.0 && *y > 0.0)
        .unwrap_or((12_192_000.0, 6_858_000.0));

    // Real slide order is `sldIdLst` → presentation rels; fall back to numbering.
    let rels = rels_map(&mut zip, "ppt/_rels/presentation.xml.rels", "ppt");
    let mut order: Vec<String> = Vec::new();
    // `r:id` loses its prefix in the tree (local names), and `sldId` also has a
    // numeric `id`; read both and keep the one that resolves in the rels.
    if let Some(list) = pres.find("sldIdLst") {
        for s in list.children_named("sldId") {
            let target = s
                .attrs
                .iter()
                .filter(|(k, _)| k == "id")
                .find_map(|(_, v)| rels.get(v).cloned());
            if let Some(t) = target {
                order.push(t);
            }
        }
    }
    if order.is_empty() {
        order = parts_in_order(&zip, "ppt/slides/slide", ".xml");
    }

    let mut budget = Budget::new();
    let mut slides = Vec::new();
    for (i, path) in order.iter().enumerate() {
        if i >= MAX_SLIDES {
            budget.truncated = true;
            break;
        }
        let Some(xml) = read_entry(&mut zip, path) else {
            continue;
        };
        let (dir, file) = path.rsplit_once('/').unwrap_or(("", path.as_str()));
        let slide_rels = rels_map(&mut zip, &format!("{dir}/_rels/{file}.rels"), dir);
        let root = parse_tree(&xml);
        let mut shapes = Vec::new();
        if let Some(tree) = root.find("spTree") {
            let ctx = SlideCtx { cx, cy, rels: &slide_rels };
            walk_shapes(tree, Xform::identity(), &ctx, &mut zip, &mut budget, &mut shapes);
        }
        slides.push(Slide { shapes });
        if budget.truncated {
            break;
        }
    }
    Ok(OfficePreview {
        kind: "slides",
        blocks: Vec::new(),
        slides,
        slide_width_pt: Some(cx / EMU_PER_PT),
        aspect: Some(cx / cy),
        skipped_images: budget.skipped_images,
        truncated: budget.truncated,
    })
}

struct SlideCtx<'a> {
    cx: f64,
    cy: f64,
    rels: &'a HashMap<String, String>,
}

/// Maps a group's child coordinate space onto the slide (EMU).
#[derive(Clone, Copy)]
struct Xform {
    sx: f64,
    sy: f64,
    tx: f64,
    ty: f64,
}

impl Xform {
    fn identity() -> Self {
        Xform { sx: 1.0, sy: 1.0, tx: 0.0, ty: 0.0 }
    }
    fn apply(&self, x: f64, y: f64, w: f64, h: f64) -> (f64, f64, f64, f64) {
        (x * self.sx + self.tx, y * self.sy + self.ty, w * self.sx, h * self.sy)
    }
}

fn num(el: Option<&El>, attr: &str) -> Option<f64> {
    el?.attr(attr)?.parse::<f64>().ok()
}

/// `<a:xfrm>` → (x, y, w, h) in EMU.
fn frame_of(xfrm: Option<&El>) -> Option<(f64, f64, f64, f64)> {
    let xfrm = xfrm?;
    let off = xfrm.child("off");
    let ext = xfrm.child("ext");
    Some((num(off, "x")?, num(off, "y")?, num(ext, "cx")?, num(ext, "cy")?))
}

fn shape_at(frame: Option<(f64, f64, f64, f64)>, xf: Xform, ctx: &SlideCtx, blocks: Vec<Block>) -> Shape {
    match frame {
        Some((x, y, w, h)) => {
            let (x, y, w, h) = xf.apply(x, y, w, h);
            Shape {
                x: Some(x / ctx.cx),
                y: Some(y / ctx.cy),
                w: Some(w / ctx.cx),
                h: Some(h / ctx.cy),
                blocks,
            }
        }
        None => Shape { x: None, y: None, w: None, h: None, blocks },
    }
}

fn walk_shapes(
    tree: &El,
    xf: Xform,
    ctx: &SlideCtx,
    zip: &mut Archive<'_>,
    budget: &mut Budget,
    out: &mut Vec<Shape>,
) {
    for el in tree.elements() {
        if budget.truncated {
            return;
        }
        match el.name.as_str() {
            "sp" | "cxnSp" => {
                let frame = frame_of(el.child("spPr").and_then(|p| p.child("xfrm")));
                let blocks = el.child("txBody").map(|b| text_body(b, budget)).unwrap_or_default();
                if !blocks.is_empty() {
                    out.push(shape_at(frame, xf, ctx, blocks));
                }
            }
            "pic" => {
                let frame = frame_of(el.child("spPr").and_then(|p| p.child("xfrm")));
                let embed = el
                    .child("blipFill")
                    .and_then(|b| b.child("blip"))
                    .and_then(|b| b.attr("embed"));
                match embed.and_then(|id| ctx.rels.get(id)).cloned() {
                    Some(entry) => {
                        if let Some(img) = picture(zip, &entry, budget) {
                            out.push(shape_at(frame, xf, ctx, vec![img]));
                        }
                    }
                    None => budget.skipped_images += 1,
                }
            }
            "graphicFrame" => {
                let frame = frame_of(el.child("xfrm"));
                if let Some(tbl) = el.find("tbl") {
                    let table = pptx_table(tbl, budget);
                    out.push(shape_at(frame, xf, ctx, vec![table]));
                }
                // Charts, SmartArt and OLE objects are not drawn.
            }
            "grpSp" => {
                let gx = el.child("grpSpPr").and_then(|p| p.child("xfrm"));
                let inner = match (frame_of(gx), gx) {
                    (Some((x, y, w, h)), Some(g)) => {
                        let ch_off = g.child("chOff");
                        let ch_ext = g.child("chExt");
                        let (cx0, cy0) = (num(ch_off, "x").unwrap_or(x), num(ch_off, "y").unwrap_or(y));
                        let (cw, chh) = (num(ch_ext, "cx").unwrap_or(w), num(ch_ext, "cy").unwrap_or(h));
                        let sx = if cw > 0.0 { w / cw } else { 1.0 };
                        let sy = if chh > 0.0 { h / chh } else { 1.0 };
                        // child → group frame, then group frame → slide via `xf`.
                        let local = Xform { sx, sy, tx: x - cx0 * sx, ty: y - cy0 * sy };
                        Xform {
                            sx: local.sx * xf.sx,
                            sy: local.sy * xf.sy,
                            tx: local.tx * xf.sx + xf.tx,
                            ty: local.ty * xf.sy + xf.ty,
                        }
                    }
                    _ => xf,
                };
                walk_shapes(el, inner, ctx, zip, budget, out);
            }
            _ => {}
        }
    }
}

/// `<p:txBody>` / `<a:txBody>` → paragraphs.
fn text_body(body: &El, budget: &mut Budget) -> Vec<Block> {
    let mut blocks = Vec::new();
    for p in body.children_named("p") {
        let mut text = String::new();
        let mut bold = false;
        let mut size: Option<f32> = None;
        for part in p.elements() {
            match part.name.as_str() {
                "r" | "fld" => {
                    if let Some(rpr) = part.child("rPr") {
                        if size.is_none() {
                            size = rpr.attr("sz").and_then(|s| s.parse::<f32>().ok()).map(|s| s / 100.0);
                        }
                        if rpr.attr("b") == Some("1") {
                            bold = true;
                        }
                    }
                    if let Some(t) = part.child("t") {
                        for n in &t.children {
                            if let Node::Text(s) = n {
                                text.push_str(s);
                            }
                        }
                    }
                }
                "br" => text.push('\n'),
                _ => {}
            }
        }
        if size.is_none() {
            size = p
                .child("endParaRPr")
                .and_then(|r| r.attr("sz"))
                .and_then(|s| s.parse::<f32>().ok())
                .map(|s| s / 100.0);
        }
        let align = p.child("pPr").and_then(|ppr| ppr.attr("algn")).map(|a| {
            match a {
                "ctr" => "center",
                "r" => "right",
                "just" | "dist" => "justify",
                _ => "left",
            }
            .to_string()
        });
        push_para(&mut blocks, &mut text, bold, size, align, budget);
    }
    blocks
}

fn pptx_table(tbl: &El, budget: &mut Budget) -> Block {
    let mut rows = Vec::new();
    for tr in tbl.children_named("tr") {
        let mut cells = Vec::new();
        for tc in tr.children_named("tc") {
            // Continuation cells of a merge carry no content of their own.
            if tc.attr("hMerge") == Some("1") || tc.attr("vMerge") == Some("1") {
                continue;
            }
            let blocks = tc.child("txBody").map(|b| text_body(b, budget)).unwrap_or_default();
            cells.push(Cell {
                blocks,
                colspan: span(tc.attr("gridSpan")),
                rowspan: span(tc.attr("rowSpan")),
            });
        }
        rows.push(cells);
    }
    Block::Table { rows }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn zip_of(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in parts {
                writer.start_file(*name, options).unwrap();
                writer.write_all(body).unwrap();
            }
            writer.finish().unwrap();
        }
        buf
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

    fn texts(blocks: &[Block]) -> Vec<String> {
        blocks
            .iter()
            .filter_map(|b| match b {
                Block::Para { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn hwpx_paragraphs_tables_and_pictures() {
        let section = r#"<?xml version="1.0"?>
<hs:sec xmlns:hs="s" xmlns:hp="p" xmlns:hc="c">
  <hp:p><hp:run><hp:secPr/><hp:t>제목 &amp; 소개</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>세컨</hp:t></hp:run><hp:run><hp:t>브레인<hp:tab/>강의</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:tbl><hp:tr>
    <hp:tc><hp:subList><hp:p><hp:run><hp:t>칸1</hp:t></hp:run></hp:p></hp:subList><hp:cellSpan colSpan="2" rowSpan="1"/></hp:tc>
  </hp:tr></hp:tbl></hp:run></hp:p>
  <hp:p><hp:run><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic></hp:run></hp:p>
  <hp:p><hp:run><hp:pic><hc:img binaryItemIDRef="image2"/></hp:pic></hp:run></hp:p>
</hs:sec>"#;
        let hpf = r#"<opf:package xmlns:opf="o"><opf:manifest>
<opf:item id="image1" href="BinData/image1.png" media-type="image/png"/>
<opf:item id="image2" href="BinData/image2.emf" media-type="image/emf"/>
</opf:manifest></opf:package>"#;
        let bytes = zip_of(&[
            ("mimetype", b"application/hwp+zip"),
            ("Contents/content.hpf", hpf.as_bytes()),
            ("Contents/section0.xml", section.as_bytes()),
            ("BinData/image1.png", PNG),
            ("BinData/image2.emf", b"emf"),
        ]);
        let p = build_preview("hwpx", &bytes).unwrap();
        assert_eq!(p.kind, "document");
        assert_eq!(texts(&p.blocks), vec!["제목 & 소개", "세컨브레인\t강의"]);
        let Block::Table { rows } = &p.blocks[2] else { panic!("table expected") };
        assert_eq!(rows[0][0].colspan, 2);
        assert_eq!(texts(&rows[0][0].blocks), vec!["칸1"]);
        let Block::Image { src } = &p.blocks[3] else { panic!("image expected") };
        assert!(src.starts_with("data:image/png;base64,"));
        assert_eq!(p.skipped_images, 1, "the EMF is skipped, not inlined");
    }

    #[test]
    fn pptx_follows_presentation_order_positions_and_tables() {
        let pres = r#"<p:presentation xmlns:p="p" xmlns:r="r">
<p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#;
        let pres_rels = r#"<Relationships xmlns="x">
<Relationship Id="rId2" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>"#;
        let slide = |body: &str| {
            format!(r#"<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>{body}</p:spTree></p:cSld></p:sld>"#)
        };
        let s1 = slide(r#"<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr>
<p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4000" b="1"/><a:t>첫 번째</a:t></a:r></a:p></p:txBody></p:sp>"#);
        let s2 = slide(r#"<p:sp><p:txBody><a:p><a:r><a:t>두 번째</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr><a:xfrm><a:off x="6096000" y="3429000"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr></p:pic>
<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData><a:tbl>
<a:tr><a:tc gridSpan="2"><a:txBody><a:p><a:r><a:t>표</a:t></a:r></a:p></a:txBody></a:tc><a:tc hMerge="1"/></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#);
        let s2_rels = r#"<Relationships xmlns="x"><Relationship Id="rIdImg" Target="../media/image1.png"/></Relationships>"#;
        let bytes = zip_of(&[
            ("ppt/presentation.xml", pres.as_bytes()),
            ("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes()),
            ("ppt/slides/slide1.xml", s1.as_bytes()),
            ("ppt/slides/slide2.xml", s2.as_bytes()),
            ("ppt/slides/_rels/slide2.xml.rels", s2_rels.as_bytes()),
            ("ppt/media/image1.png", PNG),
        ]);
        let p = build_preview("pptx", &bytes).unwrap();
        assert_eq!(p.kind, "slides");
        assert_eq!(p.slides.len(), 2);
        // sldIdLst lists slide2 first.
        assert_eq!(texts(&p.slides[0].shapes[0].blocks), vec!["두 번째"]);
        assert_eq!(p.slides[0].shapes[0].x, None, "layout-placed box has no frame");
        let pic = &p.slides[0].shapes[1];
        assert_eq!((pic.x, pic.y), (Some(0.5), Some(0.5)));
        assert!(matches!(pic.blocks[0], Block::Image { .. }));
        let Block::Table { rows } = &p.slides[0].shapes[2].blocks[0] else { panic!() };
        assert_eq!(rows[0].len(), 1, "merge continuation dropped");
        assert_eq!(rows[0][0].colspan, 2);
        let first = &p.slides[1].shapes[0];
        assert_eq!((first.w, first.h), (Some(0.5), Some(0.5)));
        let Block::Para { bold, size, align, .. } = &first.blocks[0] else { panic!() };
        assert!(*bold);
        assert_eq!(*size, Some(40.0));
        assert_eq!(align.as_deref(), Some("center"));
        assert!((p.aspect.unwrap() - 16.0 / 9.0).abs() < 1e-6);
    }

    #[test]
    fn group_children_map_into_slide_space() {
        let pres = r#"<p:presentation xmlns:p="p"><p:sldSz cx="1000" cy="1000"/></p:presentation>"#;
        let s1 = r#"<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
<p:grpSp><p:grpSpPr><a:xfrm><a:off x="500" y="500"/><a:ext cx="500" cy="500"/><a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>
<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>안</a:t></a:r></a:p></p:txBody></p:sp>
</p:grpSp></p:spTree></p:cSld></p:sld>"#;
        let bytes = zip_of(&[
            ("ppt/presentation.xml", pres.as_bytes()),
            ("ppt/slides/slide1.xml", s1.as_bytes()),
        ]);
        let p = build_preview("pptx", &bytes).unwrap();
        let s = &p.slides[0].shapes[0];
        assert_eq!((s.x, s.y, s.w, s.h), (Some(0.5), Some(0.5), Some(0.5), Some(0.5)));
    }

    /// Dev aid: `PREVIEW_FILES="a.hwpx:b.pptx" cargo test dump_real_files -- --ignored --nocapture`
    /// prints structure counts only (no document text), so it is safe on real files.
    #[test]
    #[ignore]
    fn dump_real_files() {
        fn count(blocks: &[Block], acc: &mut [usize; 3]) {
            for b in blocks {
                match b {
                    Block::Para { .. } => acc[0] += 1,
                    Block::Image { .. } => acc[2] += 1,
                    Block::Table { rows } => {
                        acc[1] += 1;
                        for row in rows {
                            for cell in row {
                                count(&cell.blocks, acc);
                            }
                        }
                    }
                }
            }
        }
        let list = std::env::var("PREVIEW_FILES").unwrap_or_default();
        for path in list.split(':').filter(|p| !p.is_empty()) {
            let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let bytes = std::fs::read(path).unwrap();
            let started = std::time::Instant::now();
            let result = build_preview(&ext, &bytes);
            let ms = started.elapsed().as_millis();
            let text = crate::extract::extract_text(std::path::Path::new(path), &ext, &bytes);
            if let (Ok(p), Ok(dir)) = (&result, std::env::var("PREVIEW_JSON_DIR")) {
                let name = std::path::Path::new(path).file_name().unwrap().to_string_lossy();
                std::fs::write(format!("{dir}/{name}.json"), serde_json::to_string(p).unwrap()).unwrap();
            }
            match result {
                Ok(p) => {
                    let mut acc = [0usize; 3];
                    count(&p.blocks, &mut acc);
                    let shapes: usize = p.slides.iter().map(|s| s.shapes.len()).sum();
                    let placed: usize = p
                        .slides
                        .iter()
                        .flat_map(|s| &s.shapes)
                        .filter(|s| s.x.is_some())
                        .count();
                    for s in &p.slides {
                        for sh in &s.shapes {
                            count(&sh.blocks, &mut acc);
                        }
                    }
                    println!(
                        "{ext} {}KB {ms}ms | paras={} tables={} images={} skipped={} slides={} shapes={} placed={} truncated={} | search_chars={} status={:?}",
                        bytes.len() / 1024, acc[0], acc[1], acc[2], p.skipped_images, p.slides.len(), shapes, placed, p.truncated,
                        text.text.chars().count(), text.status
                    );
                }
                Err(e) => println!("{ext} {}KB ERROR {e} | search status={:?}", bytes.len() / 1024, text.status),
            }
        }
    }

    #[test]
    fn garbage_and_unknown_formats_fail_cleanly() {
        assert_eq!(build_preview("hwpx", b"not a zip"), Err(PreviewError::Unreadable));
        assert_eq!(build_preview("pptx", &zip_of(&[("x", b"y")])), Err(PreviewError::Unreadable));
        assert_eq!(build_preview("hwp", b"\xD0\xCF"), Err(PreviewError::Unsupported));
    }
}
