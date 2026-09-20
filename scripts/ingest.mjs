#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  authorIdFromPluginId,
  buildShards,
  fetchBytes,
  fetchUserPk,
  isNativeLogic,
  isWasmLogic,
  parseOfficialProposal,
  parseProposal,
  officialPkHex,
  sha256Hex,
  signPayload,
  sortPlugins,
  listingCompat,
  unpackTsp2,
  verifyRelease,
} from "./lib.mjs";

function addedFiles(before, head, re) {
  if (!before || /^0+$/.test(before)) return [];
  const out = execSync(`git diff --name-only --diff-filter=A ${before} ${head}`, {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((f) => re.test(f));
}

function git(args) {
  execSync(`git ${args}`, { stdio: "inherit" });
}

function clonePacks(token) {
  const work = process.env.RUNNER_TEMP || "/tmp";
  const packs = join(work, "tianshu-plugin-packs");
  execSync(
    `git clone --depth 1 https://x-access-token:${token}@github.com/tianshu48/tianshu-plugin-packs.git ${packs}`,
    { stdio: "inherit" },
  );
  return packs;
}

function pushPack(packs, packPath, artifact, tag) {
  mkdirSync(join(packs, dirname(packPath)), { recursive: true });
  writeFileSync(join(packs, packPath), artifact);
  git(`-C ${packs} add ${packPath}`);
  git(
    `-C ${packs} -c user.email=41898282+github-actions[bot]@users.noreply.github.com -c user.name=github-actions[bot] commit -m "Add ${packPath}"`,
  );
  git(`-C ${packs} tag ${tag}`);
  git(`-C ${packs} push origin HEAD`);
  git(`-C ${packs} push origin ${tag}`);
}

function appendIndex(row) {
  const index = JSON.parse(readFileSync("index.v1.json", "utf8"));
  index.plugins = index.plugins || [];
  if (index.plugins.some(
    (r) =>
      r.plugin_id === row.plugin_id &&
      r.version === row.version &&
      (r.os || "") === (row.os || "") &&
      (r.arch || "") === (row.arch || ""),
  )) {
    throw new Error("already listed");
  }
  index.plugins.push(row);
  writeFileSync("index.v1.json", `${JSON.stringify(index, null, 2)}\n`);
}

function writeShards() {
  const index = JSON.parse(readFileSync("index.v1.json", "utf8"));
  const plugins = index.plugins || [];
  sortPlugins(plugins);
  index.plugins = plugins;
  writeFileSync("index.v1.json", `${JSON.stringify(index, null, 2)}\n`);
  mkdirSync("index", { recursive: true });
  for (const name of readdirSync("index")) {
    rmSync(join("index", name));
  }
  const shards = buildShards(plugins);
  for (const s of shards) {
    writeFileSync(s.path, s.bytes);
  }
  return shards;
}

function signChannel(sk, shards) {
  const channelBody = {
    schema: 1,
    channel: "stable",
    generated_at: Math.floor(Date.now() / 1000),
    volumes: {
      "tianshu48/tianshu-plugin-packs": {
        github: "tianshu48/tianshu-plugin-packs",
        gitcode: "tianshu48/tianshu-plugin-packs",
      },
    },
    files: shards.map((s) => ({
      path: s.path,
      sha256: s.sha256,
      id_lo: s.id_lo,
      id_hi: s.id_hi,
    })),
  };
  const seed = Buffer.from(sk, "hex");
  if (seed.length !== 32) throw new Error("signing key missing");
  writeFileSync("channel.v1.json", `${JSON.stringify(signPayload(seed, channelBody), null, 2)}\n`);
}

async function loadSignedPack(p, pk, { wasm, native, userId, authorId }) {
  const artifact = await fetchBytes(p.pack_url);
  const parts = unpackTsp2(artifact);
  if (wasm && !isWasmLogic(parts.logic)) throw new Error("pack wasm is not wasm");
  if (native && !isNativeLogic(parts.logic)) throw new Error("official pack is not native");
  const desc = JSON.parse(parts.pluginJson.toString("utf8"));
  if (desc.id !== p.plugin_id || String(desc.version) !== p.version || desc.abi !== 3) {
    throw new Error("plugin.json mismatch");
  }
  const relUrl = p.release_url || p.pack_url.replace(/[^/]+$/, "release.json");
  const env = JSON.parse((await fetchBytes(relUrl)).toString("utf8"));
  if (!verifyRelease(env, pk, artifact)) throw new Error("signature mismatch");
  const payload = JSON.parse(env.payload_json);
  if (payload.manifest?.plugin_id !== p.plugin_id) throw new Error("signed plugin_id mismatch");
  if (userId) {
    if (payload.user_id !== userId) throw new Error("signed user_id mismatch");
    if (payload.manifest?.author_id !== authorId) throw new Error("signed author_id mismatch");
  } else {
    if (payload.user_id) throw new Error("official release must not include user_id");
    if (payload.manifest?.author_id) throw new Error("official author_id must be empty");
    if (payload.manifest?.kind !== "native") throw new Error("official kind must be native");
  }
  return { artifact, desc };
}

async function ingestCommunity(file, origin, packs) {
  const m = /^proposals\/([^/]+)\/([^/]+)\.json$/.exec(file);
  const p = parseProposal(readFileSync(file, "utf8"), m[1], m[2]);
  if (!p.pack_url.endsWith(".tsz")) throw new Error(`${file}: unsigned pack cannot be merged`);
  const pk = await fetchUserPk(origin, p.user_id);
  const { artifact, desc } = await loadSignedPack(p, pk, {
    wasm: true,
    userId: p.user_id,
    authorId: authorIdFromPluginId(p.plugin_id),
  });
  const packPath = `community/${p.plugin_id}/${p.version}.tsz`;
  const tag = `${p.plugin_id}-${p.version}`;
  pushPack(packs, packPath, artifact, tag);
  appendIndex({
    plugin_id: p.plugin_id,
    author_id: authorIdFromPluginId(p.plugin_id),
    user_id: p.user_id,
    channel: "stable",
    kind: "wasm",
    version: p.version,
    abi: desc.abi,
    title: desc.title || p.plugin_id,
    description: desc.description || "",
    pack_sha256: sha256Hex(artifact),
    pack_bytes: artifact.length,
    pack: { volume: "tianshu48/tianshu-plugin-packs", tag, path: packPath },
    ...listingCompat(p),
  });
  mkdirSync(dirname(`ingested/${p.plugin_id}/${p.version}.json`), { recursive: true });
  renameSync(file, `ingested/${p.plugin_id}/${p.version}.json`);
}

async function ingestOfficial(file, packs) {
  const m = /^official\/([^/]+)\/([^/]+)\/([^/]+)\.json$/.exec(file);
  const p = parseOfficialProposal(readFileSync(file, "utf8"), m[1], m[2], m[3]);
  const pk = officialPkHex();
  const { artifact, desc } = await loadSignedPack(p, pk, { native: true });
  const packPath = `official/${p.plugin_id}/${p.version}/${p.os}-${p.arch}.tsz`;
  const tag = `${p.plugin_id}-${p.version}-${p.os}-${p.arch}`;
  pushPack(packs, packPath, artifact, tag);
  appendIndex({
    plugin_id: p.plugin_id,
    channel: "stable",
    kind: "native",
    version: p.version,
    abi: desc.abi,
    title: desc.title || p.plugin_id,
    description: desc.description || "",
    pack_sha256: sha256Hex(artifact),
    pack_bytes: artifact.length,
    pack: { volume: "tianshu48/tianshu-plugin-packs", tag, path: packPath },
    ...listingCompat(p),
  });
  mkdirSync(dirname(`ingested/official/${p.plugin_id}/${p.version}/${p.os}-${p.arch}.json`), {
    recursive: true,
  });
  renameSync(file, `ingested/official/${p.plugin_id}/${p.version}/${p.os}-${p.arch}.json`);
}

function publishListing(sk, message) {
  const shards = writeShards();
  signChannel(sk, shards);
  git("add index.v1.json index channel.v1.json ingested proposals official");
  git(
    `-c user.email=41898282+github-actions[bot]@users.noreply.github.com -c user.name=github-actions[bot] commit -m "${message}"`,
  );
  git("push origin HEAD");
}

async function main() {
  const origin = (process.env.TIANSHU_ORIGIN || "").replace(/\/$/, "");
  const before = process.env.BEFORE_SHA;
  const head = process.env.GITHUB_SHA;
  const rewrite = process.env.REWRITE_INDEX === "1";
  const community = addedFiles(before, head, /^proposals\/[^/]+\/[^/]+\.json$/);
  const official = addedFiles(before, head, /^official\/[^/]+\/[^/]+\/[^/]+\.json$/);
  const indexSk = process.env.INDEX_SK || "";
  if (community.length === 0 && official.length === 0) {
    if (!rewrite) {
      console.log("no new proposals");
      return;
    }
    if (!indexSk) throw new Error("signing key missing");
    publishListing(indexSk, "Rewrite catalog shards");
    return;
  }
  if (!indexSk) throw new Error("signing key missing");
  const packsToken = process.env.PACKS_TOKEN || "";
  if (!packsToken) throw new Error("packs token missing");
  if (community.length && !origin) throw new Error("TIANSHU_ORIGIN required");
  const packs = clonePacks(packsToken);
  for (const file of community) await ingestCommunity(file, origin, packs);
  for (const file of official) await ingestOfficial(file, packs);
  publishListing(indexSk, "Ingest plugin proposals");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
