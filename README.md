# godly-mcp-server

An MCP server that lets AI agents search and view the UI/UX design inspiration curated on [godly.design](https://godly.design): landing pages, iOS apps, and website templates, with full-page and per-section screenshots.

It needs no API key. It reads the same public files the Godly site loads: `/search-data.json`, the Markdown versions of pages (`/websites.md`, `/website/<slug>.md`, ...), `/sitemap.xml`, and screenshots from `cdn.godly.design`.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_inspiration` | Keyword search across websites, apps, and templates. Filter by `kind` and `category`, page with `limit`/`offset`. Leave out `query` to browse newest first. |
| `list_section_inspiration` | Browse curated `hero`, `cta`, `footer`, `og-images`, `logos`, or `trending` galleries. Each result includes a direct image URL for that section crop. |
| `list_categories` | Category names and counts for the `category` filter. |
| `get_inspiration` | Details for one item: description, live URL, metadata (industry, App Store rating, template price/author), and every screenshot URL. Set `include_preview: true` to also get the first screenshot inline. |
| `view_image` | Returns a `cdn.godly.design` screenshot as an image the model can see. Tall full-page captures are resized and split into vertical tiles; request more tiles with `page`. |

A typical agent flow: `search_inspiration` → `get_inspiration` → `view_image` (one tile per call).

## Setup

Requires Node.js 18.17 or later.

```bash
git clone https://github.com/noahchalifour/godly-mcp-server.git
cd godly-mcp-server
npm install      # also builds dist/
npm test         # end-to-end tests against live godly.design
```

### Claude Code

```bash
claude mcp add godly -- node /absolute/path/to/godly-mcp-server/dist/index.js
```

### Claude Desktop, Cursor, and other MCP clients

```json
{
  "mcpServers": {
    "godly": {
      "command": "node",
      "args": ["/absolute/path/to/godly-mcp-server/dist/index.js"]
    }
  }
}
```

## Notes and limits

- The site index is cached in memory for one hour.
- Godly publishes Markdown listings for about 40 recent websites and about 830 apps. Templates come from the sitemap, and only the newest ones carry titles and categories in the search index, so older templates match on their slug alone.
- Godly does not expose categories or styles for websites. Search websites by keyword (the description and industry are searched) or use the section galleries.
- Images are returned as JPEG at 1024px wide by default (configurable from 200 to 1280px), in tiles of up to 1600px tall, to keep each response a reasonable size for model context.
- This server depends on Godly's current page structure. If Godly changes it, the parsing in `src/godly.ts` may need updating.

## License

MIT
