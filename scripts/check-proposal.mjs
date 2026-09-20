#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  authorIdFromPluginId,
  fetchBytes,
  fetchUserPk,
  isNativeLogic,
  isWasmLogic,
  parseOfficialProposal,
  parseProposal,
  officialPkHex,
  unpackTsp2,
  verifyRelease,
} from "./lib.mjs";

function changedFiles(base, head) {
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function communityPath(file) {
  const m = /^proposals\/([^/]+)\/([^/]+)\.json$/.exec(file);
  return m ? { id: m[1], ver: m[2] } : null;
}

function officialPath(file) {
  const m = /^official\/([^/]+)\/([^/]+)\/([^/]+)\.json$/.exec(file);
  return m ? { id: m[1], ver: m[2], plat: m[3] } : null;
}

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function checkCommunity(file, id, ver, origin) {
  if (!origin) throw new Error("TIANSHU_ORIGIN required");
  const p = parseProposal(readFileSync(file, "utf8"), id, ver);
  await fetchUserPk(origin, p.user_id);
  if (!p.pack_url.endsWith(".tsz")) {
    console.log("unsigned; merge needs a signed .tsz");
    return;
  }
  const artifact = await fetchBytes(p.pack_url);
  const parts = unpackTsp2(artifact);
  if (!isWasmLogic(parts.logic)) throw new Error("pack wasm is not wasm");
  const desc = JSON.parse(parts.pluginJson.toString("utf8"));
  if (desc.id !== id || String(desc.version) !== ver) throw new Error("plugin.json does not match path");
  if (desc.abi !== 3) throw new Error("abi must be 3");
  const relUrl = p.release_url || p.pack_url.replace(/[^/]+$/, "release.json");
  const env = JSON.parse((await fetchBytes(relUrl)).toString("utf8"));
  const pk = await fetchUserPk(origin, p.user_id);
  if (!verifyRelease(env, pk, artifact)) throw new Error("signature does not match user key");
  const payload = JSON.parse(env.payload_json);
  if (payload.user_id !== p.user_id) throw new Error("signed user_id does not match proposal");
  if (payload.manifest?.plugin_id !== id) throw new Error("signed plugin_id does not match");
  if (payload.manifest?.author_id !== authorIdFromPluginId(id)) {
    throw new Error("signed author_id does not match");
  }
  console.log("signed pack ok", sha(artifact));
}

async function checkOfficial(file, id, ver, plat) {
  const p = parseOfficialProposal(readFileSync(file, "utf8"), id, ver, plat);
  const artifact = await fetchBytes(p.pack_url);
  const parts = unpackTsp2(artifact);
  if (!isNativeLogic(parts.logic)) throw new Error("official pack is not native");
  const desc = JSON.parse(parts.pluginJson.toString("utf8"));
  if (desc.id !== id || String(desc.version) !== ver) throw new Error("plugin.json does not match path");
  if (desc.abi !== 3) throw new Error("abi must be 3");
  const relUrl = p.release_url || p.pack_url.replace(/[^/]+$/, "release.json");
  const env = JSON.parse((await fetchBytes(relUrl)).toString("utf8"));
  const pk = officialPkHex();
  if (!verifyRelease(env, pk, artifact)) throw new Error("signature does not match");
  const payload = JSON.parse(env.payload_json);
  if (payload.user_id) throw new Error("official release must not include user_id");
  if (payload.manifest?.plugin_id !== id) throw new Error("signed plugin_id does not match");
  if (payload.manifest?.author_id) throw new Error("official author_id must be empty");
  if (payload.manifest?.kind !== "native") throw new Error("official kind must be native");
  console.log("official pack ok", sha(artifact));
}

async function main() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  const origin = (process.env.TIANSHU_ORIGIN || "").replace(/\/$/, "");
  const headRepo = process.env.HEAD_REPO || "";
  const indexRepo = process.env.INDEX_REPO || "";
  if (!base || !head) throw new Error("BASE_SHA and HEAD_SHA required");
  const files = changedFiles(base, head);
  const community = files.map(communityPath).filter(Boolean);
  const official = files.map(officialPath).filter(Boolean);
  if (community.length && official.length) {
    throw new Error("community and official proposals cannot share a pull request");
  }
  if (official.length) {
    if (files.length !== official.length) {
      throw new Error("official pull request may only add official/<id>/<version>/<os>-<arch>.json");
    }
    const id = official[0].id;
    const ver = official[0].ver;
    if (official.some((o) => o.id !== id || o.ver !== ver)) {
      throw new Error("one official plugin version per pull request");
    }
    if (!headRepo || headRepo !== indexRepo) {
      throw new Error("official listings must come from the index repository, not a fork");
    }
    for (const o of official) {
      await checkOfficial(`official/${o.id}/${o.ver}/${o.plat}.json`, o.id, o.ver, o.plat);
    }
    return;
  }
  if (files.length === 0 || files.length !== community.length) {
    throw new Error("pull request may only add proposals/<id>/<version>.json");
  }
  if (community.length !== 1) throw new Error("one proposal per pull request");
  await checkCommunity(files[0], community[0].id, community[0].ver, origin);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
