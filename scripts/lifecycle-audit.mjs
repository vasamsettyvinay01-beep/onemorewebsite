// Public-surface audit for the Diwali → New Year transition.
//   node scripts/lifecycle-audit.mjs out                         (a local static export)
//   node scripts/lifecycle-audit.mjs https://theonemorecompany.com
// Checks the homepage HTML and every JS chunk it loads.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2] ?? "out";
const remote = /^https?:\/\//.test(target);

async function read(path) {
  if (remote) {
    const res = await fetch(new URL(path, target), { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  }
  return readFileSync(join(target, path === "/" ? "index.html" : path), "utf8");
}

const VENUE = [/nichols/i, /morse st/i, /77019/, /google\.com\/maps/i];
const html = await read("/");
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+?\.js/g)].map((m) => m[0]))];
const js = (await Promise.all(chunks.map(read))).join("\n");

const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok, detail });

check("homepage title", true, (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? "(none)");
check("homepage description", true, (html.match(/<meta name="description" content="([^"]*)"/) ?? [])[1] ?? "(none)");
const og = [...html.matchAll(/<meta property="og:(title|description)" content="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
check("open graph", true, og.join(" | "));
check("no JSON-LD on the homepage", !/application\/ld\+json/.test(html));
check("metadata carries no venue", !VENUE.some((re) => og.join(" ").match(re) || ((html.match(/<head>[\s\S]*<\/head>/) ?? [""])[0].match(re))));

const at = js.indexOf("evt_new_year_night");
check("New Year Night ships in the bundle", at >= 0);
if (at >= 0) {
  const start = js.lastIndexOf("{", js.lastIndexOf("id:", at));
  const end = js.indexOf("ticketTiers:[]", at);
  const record = js.slice(start, end + 14);
  check("New Year record found whole", end > at && record.length < 4000, `${record.length} chars`);
  check("New Year record has no venue / address / map", !/venue|address|mapUrl/i.test(record) && !VENUE.some((re) => re.test(record)));
  check("New Year record has no tiers", /ticketTiers:\[\]/.test(record));
}
check("test clock is not in production JS", !js.includes("lifecycle-now"));
check("sales cutoff ships to the site", js.includes("2026-11-07T22:00"));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? `  —  ${r.detail}` : ""}`);
}
console.log(`\n${chunks.length} chunks scanned from ${remote ? target : `./${target}`}`);
process.exit(failed ? 1 : 0);
