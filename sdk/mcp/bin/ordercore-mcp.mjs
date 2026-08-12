#!/usr/bin/env node
// @ordercore/mcp — npx launcher for the OrderCore MCP server.
//
// On first run it fetches the correct native `ordercore-mcp` binary from
// https://ordercore.ai/downloads, verifies its published SHA-256, caches it,
// and execs it with stdio inherited (MCP stdio transport). Cross-platform-safe:
// pure Node + zlib for zip extraction (no shelling out to unzip/tar).
//
//   npx @ordercore/mcp            # zero-config: read-only sandbox on the demo catalog
//   ORDERCORE_API_KEY=oc_live_... npx @ordercore/mcp   # full read/write (checkout)

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const VERSION = '0.2.17';
const BASE = (process.env.ORDERCORE_MCP_DOWNLOAD_BASE || 'https://ordercore.ai/downloads').replace(/\/+$/, '');
const OSMAP = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCHMAP = { arm64: 'arm64', x64: 'amd64' };

function assetInfo() {
  const o = OSMAP[process.platform];
  const a = ARCHMAP[process.arch];
  if (!o || !a) {
    console.error(`ordercore-mcp: unsupported platform ${process.platform}/${process.arch}. Download manually: ${BASE}`);
    process.exit(1);
  }
  return { asset: `ordercore-mcp-${o}-${a}`, isWindows: process.platform === 'win32' };
}

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return fetchBuffer(next, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// Extract the single file from a zip built by `zip -q9` (STORE or DEFLATE).
// Reads sizes from the central directory (reliable even with a data descriptor).
function unzipSingle(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('invalid zip: no end-of-central-directory');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('invalid zip: no central directory');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('invalid zip: no local header');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${method}`);
}

async function ensureBinary() {
  const { asset, isWindows } = assetInfo();
  const cacheDir = path.join(os.homedir(), '.cache', 'ordercore-mcp', VERSION);
  const binPath = path.join(cacheDir, isWindows ? 'ordercore-mcp.exe' : 'ordercore-mcp');
  if (fs.existsSync(binPath)) return binPath;

  fs.mkdirSync(cacheDir, { recursive: true });
  const [zip, shaFile] = await Promise.all([
    fetchBuffer(`${BASE}/${asset}.zip`),
    fetchBuffer(`${BASE}/${asset}.sha256`),
  ]);
  const expected = shaFile.toString('utf8').trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(zip).digest('hex');
  if (expected && actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}.zip (expected ${expected}, got ${actual})`);
  }
  const bin = unzipSingle(zip);
  const tmp = `${binPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bin);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, binPath);
  return binPath;
}

async function main() {
  let binPath;
  try {
    binPath = await ensureBinary();
  } catch (err) {
    console.error(`ordercore-mcp: could not obtain the binary: ${err.message}`);
    console.error(`Download it manually from ${BASE} or set ORDERCORE_MCP_DOWNLOAD_BASE.`);
    process.exit(1);
  }
  const child = spawn(binPath, process.argv.slice(2), { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(`ordercore-mcp: failed to start: ${err.message}`);
    process.exit(1);
  });
}

main();
