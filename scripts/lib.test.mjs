import test from "node:test";
import assert from "node:assert/strict";
import { zstdCompressSync } from "node:zlib";
import {
  buildShards,
  isNativeLogic,
  isWasmLogic,
  listablePluginId,
  MAGIC,
  officialPluginId,
  parseOfficialProposal,
  SHARD_MAX_BYTES,
  unpackTsp2,
} from "./lib.mjs";

test("community ids reject tianshu", () => {
  assert.equal(listablePluginId("alice.dice"), true);
  assert.equal(listablePluginId("tianshu.official.demo"), false);
  assert.equal(officialPluginId("tianshu.official.demo"), true);
  assert.equal(officialPluginId("alice.dice"), false);
});

test("native vs wasm magic", () => {
  assert.equal(isWasmLogic(Buffer.from("\0asm\0")), true);
  assert.equal(isNativeLogic(Buffer.from("\0asm\0")), false);
  assert.equal(isNativeLogic(Buffer.from("\x7fELF....")), true);
  assert.equal(isWasmLogic(Buffer.from("\x7fELF")), false);
});

test("official proposal rejects user_id and unsigned url", () => {
  assert.throws(() =>
    parseOfficialProposal(
      {
        plugin_id: "tianshu.official.demo",
        version: "1.0.0",
        user_id: "0123456789abcdef0123456789abcdef",
        pack_url: "https://github.com/tianshu48/x/releases/download/v1/a.tsz",
      },
      "tianshu.official.demo",
      "1.0.0",
    ),
  );
  assert.throws(() =>
    parseOfficialProposal(
      {
        plugin_id: "tianshu.official.demo",
        version: "1.0.0",
        pack_url: "https://github.com/tianshu48/x/releases/download/v1/a.zip",
      },
      "tianshu.official.demo",
      "1.0.0",
    ),
  );
  const p = parseOfficialProposal(
    {
      plugin_id: "tianshu.official.demo",
      version: "1.0.0",
      pack_url: "https://github.com/tianshu48/x/releases/download/v1/a.tsz",
    },
    "tianshu.official.demo",
    "1.0.0",
  );
  assert.equal(p.plugin_id, "tianshu.official.demo");
});

test("tsp2 unpacks five chunks and rejects tsp1", () => {
  const chunks = [];
  for (const c of [
    Buffer.from("{}"),
    Buffer.from("{}"),
    Buffer.from("\0asm"),
    Buffer.alloc(0),
    Buffer.alloc(0),
  ]) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(c.length);
    chunks.push(len, c);
  }
  const packed = Buffer.concat([MAGIC, Buffer.from([1, 0]), zstdCompressSync(Buffer.concat(chunks))]);
  const p = unpackTsp2(packed);
  assert.equal(p.logic[0], 0);
  assert.throws(() => unpackTsp2(Buffer.from("TSP1xxxx")));
});

test("buildShards splits at 512 but keeps one plugin_id together", () => {
  const many = Array.from({ length: 513 }, (_, i) => ({
    plugin_id: `p${String(i).padStart(4, "0")}`,
    version: "1",
  }));
  const shards = buildShards(many);
  assert.equal(shards.length, 2);
  assert.equal(shards[0].path, "index/p0000.json");
  assert.equal(shards[0].id_hi, "p0511");
  const same = Array.from({ length: 600 }, (_, i) => ({ plugin_id: "alice.dice", version: String(i) }));
  assert.equal(buildShards(same).length, 1);
});

test("buildShards splits on byte cap across different ids", () => {
  const fat = { plugin_id: "aaa.big", version: "1", description: "x".repeat(SHARD_MAX_BYTES) };
  const shards = buildShards([fat, { plugin_id: "bbb.small", version: "1" }]);
  assert.equal(shards.length, 2);
  assert.equal(shards[1].id_lo, "bbb.small");
});
