#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const id = (process.env.YANK_ID || "").trim();
const version = (process.env.YANK_VERSION || "").trim();
if (!id) {
  console.error("YANK_ID required");
  process.exit(1);
}

const index = JSON.parse(readFileSync("index.v1.json", "utf8"));
const before = (index.plugins || []).length;
index.plugins = (index.plugins || []).filter(
  (p) => !(p.plugin_id === id && (!version || p.version === version)),
);
if (index.plugins.length === before) {
  console.error("not listed");
  process.exit(1);
}
writeFileSync("index.v1.json", `${JSON.stringify(index, null, 2)}\n`);
