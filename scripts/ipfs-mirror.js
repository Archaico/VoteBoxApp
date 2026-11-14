#!/usr/bin/env node
// scripts/ipfs-mirror.js
//
// Keeps a second, independent copy of all VoteBoxApp content on IPFS.
// Pinata is the primary store; this script makes sure a second provider
// holds every CID too, so the content survives if Pinata goes away.
//
// What gets mirrored, all discovered from public sources (no app secrets):
//   - proposal JSON: CIDs in the Foundation wallet's label-674 anchors (Cardano)
//   - proposal images: the `attachments` CIDs inside each proposal JSON
//   - discussion threads: the public Firestore `comment_cids` registry
//
// Two ways to mirror (MIRROR_MODE):
//   s3-car       (default) Filebase free tier. Downloads each CID as a CAR
//                file (exact IPFS blocks) and uploads it with Filebase's CAR
//                import, so the copy keeps the identical CID. Verified after
//                upload. Token = Filebase bucket token (base64 KEY:SECRET:BUCKET).
//   pinning-api  Any service with the standard IPFS Pinning Service API
//                (paid Filebase, 4EVERLAND, your own node, …): pin by CID.
//
// Anyone can run it against their own account to help keep VoteBoxApp
// data alive. Requires Node 18+ (built-in fetch), no packages.
//
// Environment:
//   BLOCKFROST_PROJECT_ID   Blockfrost key for the network below (required)
//   PIN_SERVICE_TOKEN       mirror access token (required unless DRY_RUN=1)
//   MIRROR_MODE             s3-car (default) or pinning-api
//   PIN_SERVICE_URL         pinning-api only; default https://api.filebase.io/v1/ipfs
//   S3_ENDPOINT             s3-car only; default https://s3.filebase.com
//   CARDANO_NETWORK         preprod (default) or mainnet
//   FIREBASE_PROJECT_ID     enables comment-thread mirroring (optional)
//   SINCE_HOURS             only scan anchors newer than this; 0 = everything (default 0)
//   DRY_RUN=1               list what would be mirrored, change nothing

const crypto = require('crypto');

const NETWORK      = process.env.CARDANO_NETWORK || 'preprod';
const BLOCKFROST   = `https://cardano-${NETWORK}.blockfrost.io/api/v0`;
const BF_KEY       = process.env.BLOCKFROST_PROJECT_ID;
const MODE         = process.env.MIRROR_MODE || 's3-car';
const PIN_URL      = (process.env.PIN_SERVICE_URL || 'https://api.filebase.io/v1/ipfs').replace(/\/$/, '');
const S3_ENDPOINT  = (process.env.S3_ENDPOINT || 'https://s3.filebase.com').replace(/\/$/, '');
const PIN_TOKEN    = process.env.PIN_SERVICE_TOKEN;
const FIREBASE_PID = process.env.FIREBASE_PROJECT_ID;
const SINCE_HOURS  = Number(process.env.SINCE_HOURS || 0);
const DRY_RUN      = process.env.DRY_RUN === '1';

const FOUNDATION = {
  preprod: 'addr_test1vqfrwehprdjvxrv3kmnz7axek2jkg4sjcl5fxtwecevh74ge4rmhd',
}[NETWORK];

// Same read gateways as the app (src/services/IpfsGateways.ts).
const GATEWAYS = [
  'https://magenta-important-scorpion-739.mypinata.cloud/ipfs',
  'https://gw.ipfs-lens.dev/ipfs',
  'https://ipfs.filebase.io/ipfs',
  'https://gateway.pinata.cloud/ipfs',
];

// Where the content currently lives — tells a pinning service whom to ask.
const ORIGINS = ['/dnsaddr/bitswap-v3.pinata.cloud'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, headers = {}, ms = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
}

const blockfrost = path => getJson(`${BLOCKFROST}${path}`, { project_id: BF_KEY });

// ── Discovery ───────────────────────────────────────────────────────────────

async function proposalAnchors() {
  const cutoff = SINCE_HOURS > 0 ? Date.now() / 1000 - SINCE_HOURS * 3600 : 0;
  const anchors = [];
  for (let page = 1; ; page++) {
    const txs = await blockfrost(`/addresses/${FOUNDATION}/transactions?order=desc&count=100&page=${page}`);
    if (!txs || txs.length === 0) break;
    let reachedCutoff = false;
    for (const { tx_hash, block_time } of txs) {
      if (block_time < cutoff) { reachedCutoff = true; break; }
      const md = await blockfrost(`/txs/${tx_hash}/metadata`);
      const p = (md || []).find(m => m.label === '674')?.json_metadata;
      if (p?.cid && (p.platform === 'VoteBoxApp' || p.platform === 'VoteBox')) {
        anchors.push({ proposalId: p.proposalId, cid: p.cid });
      }
    }
    if (reachedCutoff || txs.length < 100) break;
  }
  return anchors;
}

async function fetchFromIpfs(cid) {
  for (const g of GATEWAYS) {
    try { return await getJson(`${g}/${cid}`, {}, 10000); } catch {}
  }
  return null;
}

async function commentThreads() {
  if (!FIREBASE_PID) return [];
  const threads = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PID}/databases/(default)/documents/comment_cids?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await getJson(url);
    for (const d of page?.documents || []) {
      const cid = d.fields?.cid?.stringValue;
      if (cid) threads.push({ cid, name: `comments ${d.fields?.proposalId?.stringValue || ''}`.trim() });
    }
    pageToken = page?.nextPageToken || '';
  } while (pageToken);
  return threads;
}

// ── Mode: pinning-api ───────────────────────────────────────────────────────

const pinHeaders = () => ({ Authorization: `Bearer ${PIN_TOKEN}`, 'Content-Type': 'application/json' });

const pinningApi = {
  // The Pinning Service API filters by up to 10 CIDs per request.
  async alreadyMirrored(cids) {
    const have = new Set();
    for (let i = 0; i < cids.length; i += 10) {
      const batch = cids.slice(i, i + 10).join(',');
      const res = await getJson(`${PIN_URL}/pins?cid=${batch}&status=queued,pinning,pinned&limit=1000`, pinHeaders());
      for (const r of res?.results || []) have.add(r.pin.cid);
    }
    return have;
  },
  async mirror(cid, name) {
    const res = await fetch(`${PIN_URL}/pins`, {
      method: 'POST',
      headers: pinHeaders(),
      body: JSON.stringify({ cid, name: name.slice(0, 255), origins: ORIGINS }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).status;
  },
};

// ── Mode: s3-car (Filebase free tier) ───────────────────────────────────────

// Minimal AWS Signature V4, enough for Filebase's S3 API.
function s3Request(method, key, body = Buffer.alloc(0), extraHeaders = {}) {
  const [accessKey, secret, bucket] = Buffer.from(PIN_TOKEN, 'base64').toString('utf8').split(':');
  const host = new URL(S3_ENDPOINT).host;
  const region = 'us-east-1';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
  const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();

  const uri = `/${bucket}/${encodeURIComponent(key)}`;
  const headers = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': sha256(body), ...extraHeaders };
  const names = Object.keys(headers).sort();
  const canonical = [method, uri, '', ...names.map(n => `${n}:${String(headers[n]).trim()}`), '', names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');

  delete headers.host;
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return fetch(`${S3_ENDPOINT}${uri}`, {
    method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(60000),
  });
}

// Not every gateway honours ?format=car (Pinata returns the plain file), so
// accept only a real CAR response.
async function fetchCar(cid) {
  for (const g of GATEWAYS) {
    try {
      const res = await fetch(`${g}/${cid}?format=car`, {
        headers: { Accept: 'application/vnd.ipld.car' }, signal: AbortSignal.timeout(30000),
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('ipld.car')) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch {}
  }
  return null;
}

const s3Car = {
  async alreadyMirrored(cids) {
    const have = new Set();
    for (const cid of cids) {
      const res = await s3Request('HEAD', `${cid}.car`);
      if (res.ok && res.headers.get('x-amz-meta-cid') === cid) have.add(cid);
    }
    return have;
  },
  async mirror(cid) {
    const car = await fetchCar(cid);
    if (!car) throw new Error('no gateway returned a CAR file');
    const put = await s3Request('PUT', `${cid}.car`, car, { 'x-amz-meta-import': 'car' });
    if (!put.ok) throw new Error(`upload ${put.status} ${(await put.text()).slice(0, 200)}`);
    // Filebase reports the root CID it imported; it must equal the one we asked for.
    const head = await s3Request('HEAD', `${cid}.car`);
    const got = head.headers.get('x-amz-meta-cid');
    if (got !== cid) {
      await s3Request('DELETE', `${cid}.car`);
      throw new Error(`imported CID ${got} does not match — removed`);
    }
    return `copied (${car.length} bytes, CID verified)`;
  },
};

// ── Run ─────────────────────────────────────────────────────────────────────

(async () => {
  const target = { 's3-car': s3Car, 'pinning-api': pinningApi }[MODE];
  if (!target) throw new Error(`Unknown MIRROR_MODE "${MODE}"`);
  if (!FOUNDATION) throw new Error(`No Foundation wallet configured for ${NETWORK}`);
  if (!BF_KEY) throw new Error('BLOCKFROST_PROJECT_ID is not set');
  if (!PIN_TOKEN && !DRY_RUN) throw new Error('PIN_SERVICE_TOKEN is not set (or use DRY_RUN=1)');

  const wanted = new Map(); // cid -> name

  const anchors = await proposalAnchors();
  console.log(`Found ${anchors.length} proposal anchor(s) on ${NETWORK}${SINCE_HOURS ? ` in the last ${SINCE_HOURS} h` : ''}`);
  for (const { proposalId, cid } of anchors) {
    wanted.set(cid, `proposal ${proposalId || ''}`.trim());
    const proposal = await fetchFromIpfs(cid);
    if (!proposal) { console.warn(`  ! could not read ${proposalId} (${cid}) from any gateway`); continue; }
    (proposal.attachments || []).forEach((a, i) => wanted.set(a, `image ${i + 1} ${proposalId || ''}`.trim()));
  }

  const threads = await commentThreads();
  if (FIREBASE_PID) console.log(`Found ${threads.length} comment thread(s)`);
  for (const t of threads) wanted.set(t.cid, t.name);

  const cids = [...wanted.keys()];
  if (DRY_RUN) {
    console.log(`\nDRY RUN (${MODE}) — would make sure these ${cids.length} CID(s) are mirrored:`);
    for (const cid of cids) console.log(`  ${cid}  ${wanted.get(cid)}`);
    return;
  }

  const have = await target.alreadyMirrored(cids);
  const missing = cids.filter(c => !have.has(c));
  console.log(`${cids.length} CID(s) total, ${have.size} already mirrored, ${missing.length} to mirror (${MODE})`);

  let failed = 0;
  for (const cid of missing) {
    try {
      console.log(`  + ${cid}  ${wanted.get(cid)} -> ${await target.mirror(cid, wanted.get(cid))}`);
    } catch (e) {
      failed++;
      console.error(`  ! ${cid}  ${wanted.get(cid)}: ${e.message}`);
    }
    await sleep(300);
  }
  if (failed) { console.error(`${failed} CID(s) failed`); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
