// Data access layer for https://godly.design.
// Godly has no public API; we use the same public assets its own site uses:
//   - /search-data.json   (site search index: titles, slugs, thumbnails, categories)
//   - /<page>.md          (Markdown twins of listing and detail pages)
//   - /templates/<slug>   (HTML; templates have no Markdown twin)
//   - /sitemap.xml        (complete slug list)
//   - cdn.godly.design    (screenshots)
import sharp from "sharp";

export const BASE = "https://godly.design";
const CDN = "https://cdn.godly.design";
const UA = "godly-mcp-server/1.0 (+https://github.com/noahchalifour/godly-mcp-server)";
const INDEX_TTL_MS = 60 * 60 * 1000;

export type Kind = "website" | "app" | "template";

export interface Item {
  kind: Kind;
  slug: string;
  title: string;
  description: string;
  url: string;
  thumbnail?: string;
  categories: string[];
  extra?: Record<string, string>;
}

// Section galleries on godly.design and the screenshot file each one maps to.
export const SECTIONS = {
  hero: "hero-desktop.png",
  cta: "cta-desktop.png",
  footer: "footer-desktop.png",
  "og-images": "og-image.png",
  logos: "favicon.png",
  trending: "thumbnail.png",
} as const;
export type Section = keyof typeof SECTIONS;

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res;
}
const text = async (url: string) => (await get(url)).text();

// "- [Title](/website/slug) - description" lines from a listing .md page.
function parseListing(md: string): { title: string; path: string; description: string }[] {
  const out = [];
  for (const m of md.matchAll(/^- \[(.+?)\]\((\/[^)]+)\)(?: - (.*))?$/gm)) {
    const description = (m[3] ?? "").trim();
    out.push({ title: m[1], path: m[2], description: description === "metadata.description" ? "" : description });
  }
  return out;
}

let cache: { at: number; items: Item[]; categories: { name: string; count: number }[] } | undefined;

export async function loadIndex() {
  if (cache && Date.now() - cache.at < INDEX_TTL_MS) return cache;
  const [searchData, websitesMd, appsMd, sitemap] = await Promise.all([
    get(`${BASE}/search-data.json`).then((r) => r.json() as Promise<Record<string, any>>),
    text(`${BASE}/websites.md`),
    text(`${BASE}/apps.md`),
    text(`${BASE}/sitemap.xml`),
  ]);

  const items = new Map<string, Item>();
  const key = (k: Kind, s: string) => `${k}:${s}`;
  const urlFor = (k: Kind, s: string) => `${BASE}/${k === "website" ? "website" : k === "app" ? "app" : "templates"}/${s}`;

  for (const [list, kind] of [[websitesMd, "website"], [appsMd, "app"]] as const) {
    for (const e of parseListing(list)) {
      const slug = e.path.split("/").pop()!;
      items.set(key(kind, slug), { kind, slug, title: e.title, description: e.description, url: urlFor(kind, slug), categories: [] });
    }
  }
  // Templates: only slugs are guaranteed (sitemap); search-data enriches the newest ones.
  for (const m of sitemap.matchAll(/<loc>https:\/\/godly\.design\/(website|app|templates)\/([^<]+)<\/loc>/g)) {
    const kind: Kind = m[1] === "templates" ? "template" : (m[1] as Kind);
    const slug = m[2];
    if (!items.has(key(kind, slug))) {
      items.set(key(kind, slug), { kind, slug, title: slug.replace(/-/g, " "), description: "", url: urlFor(kind, slug), categories: [] });
    }
  }
  for (const [field, kind] of [["websites", "website"], ["apps", "app"], ["templates", "template"]] as const) {
    for (const d of searchData[field] ?? []) {
      const it: Item = items.get(key(kind, d.slug)) ?? { kind, slug: d.slug, title: d.title, description: "", url: urlFor(kind, d.slug), categories: [] };
      it.title = d.title || it.title;
      it.thumbnail = d.image;
      it.categories = d.categories ?? [];
      if (!it.description && d.subtitle) it.description = d.subtitle;
      if (kind === "template") it.extra = { price: d.price, framework: d.framework, author: d.author };
      if (kind === "website") it.extra = { domain: d.subtitle };
      items.set(key(kind, d.slug), it);
    }
  }
  for (const it of items.values()) {
    if (!it.thumbnail && it.kind === "website") it.thumbnail = `${CDN}/sites/${it.slug}/thumbnail.png`;
    if (!it.thumbnail && it.kind === "template") it.thumbnail = `${CDN}/templates/${it.slug}/desktop-full.png`;
  }
  cache = { at: Date.now(), items: [...items.values()], categories: searchData.categories ?? [] };
  return cache;
}

export interface SearchOptions {
  query?: string;
  kind?: Kind | "all";
  category?: string;
  limit?: number;
  offset?: number;
}

export async function search(opts: SearchOptions) {
  const { items } = await loadIndex();
  const terms = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const cat = opts.category?.toLowerCase();
  const scored = items
    .filter((it) => !opts.kind || opts.kind === "all" || it.kind === opts.kind)
    .filter((it) => !cat || it.categories.some((c) => c.toLowerCase() === cat))
    .map((it, i) => {
      if (!terms.length) return { it, score: 1, i };
      const title = it.title.toLowerCase();
      const hay = `${title} ${it.slug} ${it.description} ${it.categories.join(" ")} ${Object.values(it.extra ?? {}).join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return { it, score: 0, i };
        score += title.includes(t) ? 3 : 1;
      }
      return { it, score, i };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i); // keep site order (newest first) on ties
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 20;
  return { total: scored.length, results: scored.slice(offset, offset + limit).map((s) => s.it) };
}

export async function listSection(section: Section, limit = 40) {
  const entries = parseListing(await text(`${BASE}/${section}.md`)).slice(0, limit);
  return entries.map((e) => {
    const slug = e.path.split("/").pop()!;
    const isSite = e.path.startsWith("/website/");
    return {
      title: e.title,
      slug,
      kind: (isSite ? "website" : "app") as Kind,
      description: e.description,
      url: BASE + e.path,
      image: isSite ? `${CDN}/sites/${slug}/${SECTIONS[section]}` : undefined,
    };
  });
}

export interface Detail {
  kind: Kind;
  slug: string;
  title: string;
  description: string;
  pageUrl: string;
  liveUrl?: string;
  metadata: Record<string, string>;
  images: { label: string; url: string }[];
  body?: string;
}

function frontmatter(md: string) {
  const fm: Record<string, string> = {};
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  for (const line of m?.[1].split("\n") ?? []) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

function bullets(md: string) {
  const out: Record<string, string> = {};
  for (const m of md.matchAll(/^- \*\*(.+?)\*\*: ?(.*)$/gm)) {
    const v = m[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if (v && !v.includes("[object Object]")) out[m[1]] = v;
  }
  return out;
}

export async function getDetail(kind: Kind, slug: string): Promise<Detail> {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) throw new Error(`Invalid slug: ${slug}`);
  if (kind === "template") return getTemplate(slug);

  const path = kind === "website" ? `/website/${slug}` : `/app/${slug}`;
  const md = await text(`${BASE}${path}.md`);
  if (md.trimStart().startsWith("<")) throw new Error(`No ${kind} found with slug "${slug}"`);
  const fm = frontmatter(md);
  const meta = bullets(md);
  const images: Detail["images"] = [];
  for (const m of md.matchAll(/!\[([^\]]*)\]\((https:\/\/cdn\.godly\.design\/[^)]+)\)/g)) {
    images.push({ label: m[1].replace(/ Screenshot$/, "").replace(/ screenshot/, ""), url: m[2] });
  }
  if (kind === "website") {
    // The .md drops section data; the page HTML lists the section crops that actually exist.
    const html = await text(`${BASE}${path}`).catch(() => "");
    const seen = new Set(images.map((i) => i.url));
    for (const m of html.matchAll(new RegExp(`${CDN}/sites/${slug}/([a-z0-9-]+)\\.(png|jpe?g|webp)`, "g"))) {
      const url = m[0];
      if (seen.has(url) || /^(favicon|thumbnail)$/.test(m[1])) continue;
      seen.add(url);
      images.push({ label: m[1], url });
    }
  }
  let body: string | undefined;
  if (kind === "app") {
    const start = md.indexOf("\n", md.indexOf("\n# ") + 1);
    const end = md.search(/\n- \*\*/);
    body = md.slice(start, end > 0 ? end : undefined).trim().slice(0, 2000);
  }
  return {
    kind,
    slug,
    title: fm.title ?? slug,
    description: fm.description ?? "",
    pageUrl: BASE + path,
    liveUrl: fm.url,
    metadata: meta,
    images,
    body,
  };
}

async function getTemplate(slug: string): Promise<Detail> {
  const res = await fetch(`${BASE}/templates/${slug}`, { headers: { "user-agent": UA } });
  if (res.status === 404) throw new Error(`No template found with slug "${slug}"`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for template ${slug}`);
  const html = await res.text();
  let product: any = {};
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@type"] === "Product") product = j;
    } catch {}
  }
  const images = [...new Set(html.match(new RegExp(`${CDN}/templates/${slug}/[a-z0-9-]+\\.(?:png|jpe?g|webp)`, "g")) ?? [])].map(
    (url) => ({ label: url.split("/").pop()!.replace(/\.\w+$/, ""), url }),
  );
  const external = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !/godly\.design|\/\/(x|twitter)\.com/.test(u));
  const buyUrl = product.offers?.url as string | undefined;
  const liveUrl = external.find((u) => u !== buyUrl);
  const { items } = await loadIndex();
  const idx = items.find((i) => i.kind === "template" && i.slug === slug);
  const metadata: Record<string, string> = { ...(idx?.extra ?? {}) };
  if (product.offers?.price) metadata.price = `$${product.offers.price}`;
  if (buyUrl) metadata.purchaseUrl = buyUrl;
  if (idx?.categories.length) metadata.categories = idx.categories.join(", ");
  for (const k of Object.keys(metadata)) if (!metadata[k]) delete metadata[k];
  return {
    kind: "template",
    slug,
    title: product.name ?? idx?.title ?? slug,
    description: product.description ?? "",
    pageUrl: `${BASE}/templates/${slug}`,
    liveUrl,
    metadata,
    images,
  };
}

export interface ViewOptions {
  /** Output width in px (screenshots are 1280px wide desktop / 400px mobile). */
  width?: number;
  /** Max height (in source pixels, after width scaling) of one returned tile. */
  tileHeight?: number;
  /** 0-based tile index for tall full-page screenshots. */
  page?: number;
}

/** Fetch a godly CDN image and return a size-bounded JPEG tile, plus paging info. */
export async function viewImage(url: string, opts: ViewOptions = {}) {
  const u = new URL(url);
  if (u.hostname !== "cdn.godly.design") throw new Error("Only https://cdn.godly.design images can be viewed");
  if (/\.(mp4|webm|mov)$/i.test(u.pathname)) throw new Error("Videos cannot be viewed as images");
  const buf = Buffer.from(await (await get(url)).arrayBuffer());
  const meta = await sharp(buf).metadata();
  const srcW = meta.width ?? 1280;
  const srcH = meta.height ?? 1;
  const width = Math.min(opts.width ?? 1024, srcW);
  const resized = await sharp(buf).resize({ width }).toBuffer({ resolveWithObject: true });
  const scaledH = resized.info.height;
  const tileH = opts.tileHeight ?? 1600;
  const pages = Math.max(1, Math.ceil(scaledH / tileH));
  const page = Math.min(Math.max(0, opts.page ?? 0), pages - 1);
  const top = page * tileH;
  const height = Math.min(tileH, scaledH - top);
  const out = await sharp(resized.data)
    .extract({ left: 0, top, width: resized.info.width, height })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { data: out.toString("base64"), mimeType: "image/jpeg", page, pages, width, height, source: { width: srcW, height: srcH } };
}
