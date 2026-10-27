// End-to-end: spawns the built server over stdio and calls every tool against live godly.design.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client;
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const data = (r) => JSON.parse(r.content[0].text);

before(async () => {
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
});
after(() => client.close());

test("lists tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_inspiration", "list_categories", "list_section_inspiration", "search_inspiration", "view_image"]);
});

test("list_categories", async () => {
  const d = data(await call("list_categories"));
  assert.ok(d.totals.website > 10 && d.totals.app > 100 && d.totals.template > 10, JSON.stringify(d.totals));
});

test("search websites by keyword", async () => {
  const d = data(await call("search_inspiration", { query: "AI", kind: "website", limit: 5 }));
  assert.ok(d.total > 0);
  assert.ok(d.results.every((r) => r.kind === "website"));
});

test("search apps by category", async () => {
  const d = data(await call("search_inspiration", { kind: "app", category: "Productivity", limit: 3 }));
  assert.equal(d.results.length, 3);
});

test("section gallery", async () => {
  const d = data(await call("list_section_inspiration", { section: "hero", limit: 3 }));
  assert.equal(d.length, 3);
  assert.match(d[0].image, /hero-desktop\.png$/);
});

test("website detail + view tiles", async () => {
  const [site] = data(await call("search_inspiration", { kind: "website", limit: 1 })).results;
  const r = await call("get_inspiration", { kind: "website", slug: site.slug, include_preview: true });
  const d = data(r);
  assert.ok(d.liveUrl && d.images.some((i) => i.label.includes("Desktop")));
  assert.equal(r.content.at(-1).type, "image");
  const full = d.images.find((i) => /desktop-full/.test(i.url));
  const v = await call("view_image", { url: full.url, page: 1 });
  assert.equal(v.content[1].type, "image");
  assert.match(v.content[0].text, /Tile 2 of \d+/);
});

test("app detail", async () => {
  const d = data(await call("get_inspiration", { kind: "app", slug: "not-boring-calculator" }));
  assert.ok(d.images.length > 0 && d.metadata.Rating);
});

test("template detail", async () => {
  const [t] = data(await call("search_inspiration", { kind: "template", limit: 1 })).results;
  const d = data(await call("get_inspiration", { kind: "template", slug: t.slug }));
  assert.ok(d.images.length > 0, JSON.stringify(d));
});

test("errors are tool errors", async () => {
  assert.equal((await call("get_inspiration", { kind: "website", slug: "definitely-not-real-xyz" })).isError, true);
  assert.equal((await call("view_image", { url: "https://example.com/a.png" })).isError, true);
});
