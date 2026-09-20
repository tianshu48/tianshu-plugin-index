import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";

export const MAGIC = Buffer.from("TSP2");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const MAX_PACK = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED = MAX_PACK * 5 + 32;

const PACK_URL = /^https:\/\/(github\.com|gitcode\.com)\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/?#]+\.tsz$/;

export function listablePluginId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id)) return false;
  const low = id.toLowerCase();
  if (id === "example.community.template") return false;
  for (const part of low.split(".")) {
    if (part === "tianshu" || part === "tianshu48" || part.startsWith("tianshu-") || part.startsWith("tianshu48-")) {
      return false;
    }
  }
  return true;
}

export function officialPluginId(id) {
  return typeof id === "string" && /^tianshu\.[a-z][a-z0-9-]+(\.[a-z0-9-]+)*$/.test(id);
}

export function userIdOk(id) {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

export function packUrlOk(url) {
  return typeof url === "string" && PACK_URL.test(url);
}

export function unpackTsp2(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6 || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error("not a TSP2 pack");
  }
  if (buf[4] !== 1) throw new Error("plugin bundle version");
  const hintLen = buf[5];
  if (hintLen > 64 || buf.length < 6 + hintLen) throw new Error("plugin bundle hint");
  const hint = buf.subarray(6, 6 + hintLen);
  if (!Buffer.from(hint.toString("utf8"), "utf8").equals(hint)) {
    throw new Error("plugin bundle hint");
  }
  const plain = zstdDecompressSync(buf.subarray(6 + hintLen));
  if (plain.length > MAX_UNCOMPRESSED) throw new Error("plugin bundle too large");
  const parts = [];
  let o = 0;
  for (let i = 0; i < 5; i++) {
    if (o + 4 > plain.length) throw new Error("truncated pack");
    const n = plain.readUInt32BE(o);
    o += 4;
    if (n > MAX_PACK || o + n > plain.length) throw new Error("truncated pack");
    parts.push(plain.subarray(o, o + n));
    o += n;
  }
  if (o !== plain.length) throw new Error("plugin bundle trailing");
  return {
    pluginJson: parts[0],
    uiJson: parts[1],
    logic: parts[2],
    icon: parts[3],
    readme: parts[4],
  };
}

export function isWasmLogic(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from("\0asm"));
}

export function isNativeLogic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || isWasmLogic(buf)) return false;
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true;
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true;
  const be = buf.readUInt32BE(0);
  return (
    be === 0xfeedface ||
    be === 0xcefaedfe ||
    be === 0xfeedfacf ||
    be === 0xcffaedfe ||
    be === 0xcafebabe ||
    be === 0xbebafeca
  );
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function verifyRelease(envelope, publicKeyHex, artifact) {
  const pk = Buffer.from(publicKeyHex, "hex");
  if (pk.length !== 32) return false;
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pk]),
    format: "der",
    type: "spki",
  });
  if (
    !verify(
      null,
      Buffer.from(envelope.payload_json, "utf8"),
      key,
      Buffer.from(envelope.signature_hex, "hex"),
    )
  ) {
    return false;
  }
  const payload = JSON.parse(envelope.payload_json);
  return payload.artifact_sha256_hex === sha256Hex(artifact);
}

export function signPayload(seed, payload) {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const payload_json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    payload_json,
    signature_hex: sign(null, Buffer.from(payload_json, "utf8"), key).toString("hex"),
  };
}

export async function fetchUserPk(origin, userId) {
  const base = origin.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/users/${userId}/key`);
  if (res.status === 404) throw new Error("unknown user or no user key");
  if (!res.ok) throw new Error(`user key http ${res.status}`);
  const body = await res.json();
  if (body.user_id !== userId || !/^[0-9a-f]{64}$/.test(body.pk_hex || "")) {
    throw new Error("bad user key response");
  }
  return body.pk_hex;
}

export async function fetchBytes(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`pack http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PACK) throw new Error("pack too large");
  return buf;
}

export function authorIdFromPluginId(id) {
  const i = id.indexOf(".");
  return i === -1 ? id : id.slice(0, i);
}

export function parseProposal(raw, pathId, pathVer) {
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (p.plugin_id !== pathId || p.version !== pathVer) {
    throw new Error("proposal path does not match plugin_id/version");
  }
  if (!listablePluginId(p.plugin_id)) throw new Error("id is not listable");
  if (!userIdOk(p.user_id)) throw new Error("user_id must be 32 lowercase hex chars");
  if (!packUrlOk(p.pack_url)) throw new Error("pack_url must be a GitHub or GitCode release asset");
  return p;
}

export function parseOfficialProposal(raw, pathId, pathVer, pathPlat) {
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (p.plugin_id !== pathId || p.version !== pathVer) {
    throw new Error("proposal path does not match plugin_id/version");
  }
  const plat = /^(linux|windows|macos)-(x86_64|aarch64)$/.exec(pathPlat || "");
  if (!plat || p.os !== plat[1] || p.arch !== plat[2]) {
    throw new Error("proposal path does not match os/arch");
  }
  if (!officialPluginId(p.plugin_id)) throw new Error("id is not an official plugin id");
  if (p.user_id) throw new Error("official proposal must not include user_id");
  if (!packUrlOk(p.pack_url)) throw new Error("pack_url must be a GitHub or GitCode release asset");
  if (!p.pack_url.endsWith(".tsz")) throw new Error("official pack_url must be a signed .tsz");
  return p;
}

export function officialPkHex() {
  const hex = (process.env.PK_SERVER_HEX || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("official verify key missing");
  return hex;
}

export const SHARD_MAX_PLUGINS = 512;
export const SHARD_MAX_BYTES = 256 * 1024;

export function packSemverCore(s) {
  const core = String(s ?? "").split(/[-+]/)[0];
  const p = core.split(".");
  return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
}

export function listingCompat(p) {
  const extra = {};
  if (p && p.paid === false) extra.paid = false;
  const req = p?.engines?.tianshu;
  if (typeof req === "string" && req.trim()) {
    extra.engines = { tianshu: req.trim() };
  }
  if (p && (p.os === "linux" || p.os === "windows" || p.os === "macos")) extra.os = p.os;
  if (p && (p.arch === "x86_64" || p.arch === "aarch64")) extra.arch = p.arch;
  return extra;
}

export function sortPlugins(plugins) {
  plugins.sort((a, b) => {
    if (a.plugin_id !== b.plugin_id) return a.plugin_id < b.plugin_id ? -1 : 1;
    const A = packSemverCore(a.version);
    const B = packSemverCore(b.version);
    for (let i = 0; i < 3; i++) {
      if (A[i] !== B[i]) return A[i] - B[i];
    }
    const va = String(a.version);
    const vb = String(b.version);
    if (va !== vb) return va < vb ? -1 : 1;
    const oa = String(a.os || "");
    const ob = String(b.os || "");
    if (oa !== ob) return oa < ob ? -1 : 1;
    const aa = String(a.arch || "");
    const ab = String(b.arch || "");
    return aa < ab ? -1 : aa > ab ? 1 : 0;
  });
}

export function listingBytes(plugins) {
  return Buffer.from(JSON.stringify({ schema: 1, plugins }));
}

export function buildShards(pluginsIn) {
  const plugins = [...pluginsIn];
  sortPlugins(plugins);
  const groups = [];
  let cur = [];
  for (const p of plugins) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      if (
        last.plugin_id !== p.plugin_id &&
        (cur.length >= SHARD_MAX_PLUGINS || listingBytes(cur).length >= SHARD_MAX_BYTES)
      ) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(p);
  }
  groups.push(cur);
  return groups.map((g, i) => {
    const bytes = listingBytes(g);
    return {
      path: `index/p${String(i).padStart(4, "0")}.json`,
      bytes,
      sha256: sha256Hex(bytes),
      id_lo: g[0]?.plugin_id ?? "",
      id_hi: g.at(-1)?.plugin_id ?? "",
    };
  });
}
