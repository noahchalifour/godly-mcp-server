#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDetail, listSection, loadIndex, search, SECTIONS, viewImage, type Section } from "./godly.js";

const server = new McpServer({ name: "godly", version: "1.0.0" });
const readOnly = { readOnlyHint: true, openWorldHint: true };
const kind = z.enum(["website", "app", "template"]);
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: String(e instanceof Error ? e.message : e) }], isError: true });

server.registerTool(
  "search_inspiration",
  {
    title: "Search Godly design inspiration",
    description:
      "Search godly.design's curated gallery of websites (landing pages), iOS apps, and website templates. " +
      "Matches all query words against title, description, categories, and domain. Omit `query` to browse newest first. " +
      "Returns slugs; pass one to get_inspiration for screenshots and details. Use list_categories for valid category names.",
    inputSchema: {
      query: z.string().optional().describe("Keywords, e.g. 'AI agent', 'fintech', 'portfolio', 'calculator'"),
      kind: z.enum(["website", "app", "template", "all"]).default("all"),
      category: z.string().optional().describe("Exact category, e.g. 'Productivity', 'Landing Page', 'Portfolio'"),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    annotations: readOnly,
  },
  async (args) => {
    try {
      const { total, results } = await search(args);
      return json({
        total,
        offset: args.offset,
        results: results.map((r) => ({ kind: r.kind, slug: r.slug, title: r.title, description: r.description, categories: r.categories, thumbnail: r.thumbnail, url: r.url, ...r.extra })),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_section_inspiration",
  {
    title: "Browse section galleries",
    description:
      "List Godly's curated section galleries: hero sections, CTAs, footers, OG images, logos, or trending sites. " +
      "Each result includes `image`, a direct crop of that section you can pass to view_image.",
    inputSchema: {
      section: z.enum(Object.keys(SECTIONS) as [Section, ...Section[]]),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: readOnly,
  },
  async ({ section, limit }) => {
    try {
      return json(await listSection(section, limit));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_categories",
  {
    title: "List Godly categories",
    description: "List category names (with item counts) usable as the `category` filter in search_inspiration.",
    inputSchema: {},
    annotations: readOnly,
  },
  async () => {
    try {
      const { categories, items } = await loadIndex();
      const counts = { website: 0, app: 0, template: 0 };
      for (const i of items) counts[i.kind]++;
      return json({ totals: counts, categories });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_inspiration",
  {
    title: "Get inspiration details",
    description:
      "Get full details for one Godly item: description, live URL, metadata (industry, rating, price, ...) and every screenshot URL " +
      "(full-page desktop/mobile, hero/CTA/footer crops for websites; iPhone screenshots for apps). " +
      "Set include_preview to also return the first screenshot inline.",
    inputSchema: {
      kind,
      slug: z.string().describe("Slug from search_inspiration, e.g. 'cloaked'"),
      include_preview: z.boolean().default(false),
    },
    annotations: readOnly,
  },
  async ({ kind, slug, include_preview }) => {
    try {
      const detail = await getDetail(kind, slug);
      const content: any[] = [{ type: "text", text: JSON.stringify(detail, null, 2) }];
      const first = detail.images.find((i) => /hero|iphone|desktop/.test(i.url)) ?? detail.images[0];
      if (include_preview && first) {
        const img = await viewImage(first.url, { width: 768, tileHeight: 1200 });
        content.push({ type: "text", text: `Preview of ${first.label} (tile 1/${img.pages}):` });
        content.push({ type: "image", data: img.data, mimeType: img.mimeType });
      }
      return { content };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "view_image",
  {
    title: "View a design screenshot",
    description:
      "Fetch a cdn.godly.design screenshot and return it as an image you can see. Full-page screenshots are very tall, " +
      "so they are split into vertical tiles: the response reports `pages`; request further tiles with `page`.",
    inputSchema: {
      url: z.string().url().describe("A https://cdn.godly.design/... image URL from another tool"),
      page: z.number().int().min(0).default(0).describe("0-based vertical tile index"),
      width: z.number().int().min(200).max(1280).default(1024).describe("Output width in px"),
      tile_height: z.number().int().min(400).max(4000).default(1600).describe("Max tile height in px"),
    },
    annotations: readOnly,
  },
  async ({ url, page, width, tile_height }) => {
    try {
      const img = await viewImage(url, { page, width, tileHeight: tile_height });
      return {
        content: [
          { type: "text", text: `Tile ${img.page + 1} of ${img.pages} (${img.width}x${img.height}; source ${img.source.width}x${img.source.height})${img.page + 1 < img.pages ? `. Next: page=${img.page + 1}` : ""}` },
          { type: "image", data: img.data, mimeType: img.mimeType },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
