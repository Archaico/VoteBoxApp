#!/usr/bin/env node
// scripts/ipfs-mirror.js
//
// Keeps a second, independent copy of all VoteBoxApp content on IPFS.
// Pinata is the primary store; this script asks another pinning service
// (any that implements the standard IPFS Pinning Service API — Filebase,
// 4EVERLAND, your own node via a pinning bridge, …) to pin the same CIDs.
//
// What gets mirrored, all discovered from public sources (no app secrets):
//   - proposal JSON: CIDs in the Foundation wallet's label-674 anchors (Cardano)
//   - proposal images: the `attachments` CIDs inside each proposal JSON
//   - discussion threads: the public Firestore `comment_cids` registry
//
// Anyone can run it against their own pinning account to help keep
// VoteBoxApp data alive. Requires Node 18+ (built-in fetch), no packages.
//
// Environment:
//   BLOCKFROST_PROJECT_ID   Blockfrost key for the network below (required)
//   PIN_SERVICE_TOKEN       pinning service access token (required unless DRY_RUN=1)
//   PIN_SERVICE_URL         default https://api.filebase.io/v1/ipfs
//   CARDANO_NETWORK         preprod (default) or mainnet
//   FIREBASE_PROJECT_ID     enables comment-thread mirroring (optional)
//   SINCE_HOURS             only scan anchors newer than this; 0 = everything (default 0)
//   DRY_RUN=1               list what would be pinned, change nothing

const NETWORK      = process.env.CARDANO_NETWORK || 'preprod';
const BLOCKFROST   = `https://cardano-${NETWORK}.blockfrost.io/api/v0`;
const BF_KEY       = process.env.BLOCKFROST_PROJECT_ID;
const PIN_URL      = (process.env.PIN_SERVICE_URL || 'https://api.filebase.io/v1/ipfs').replace(/\/$/, '');
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

// Where the content currently lives — tells the pinning service whom to ask.
const ORIGINS = ['/dnsaddr/bitswap-v3.pinata.cloud'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, headers = {}, ms = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
}

const blockfrost = path => getJson(`${BLOCKFROST}${path}`, { project_id: BF_KEY });

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

const pinHeaders = () => ({ Authorization: `Bearer ${PIN_TOKEN}`, 'Content-Type': 'application/json' });

// The Pinning Service API filters by up to 10 CIDs per request.
async function alreadyPinned(cids) {
  const have = new Set();
  for (let i = 0; i < cids.length; i += 10) {
    const batch = cids.slice(i, i + 10).join(',');
    const res = await getJson(`${PIN_URL}/pins?cid=${batch}&status=queued,pinning,pinned&limit=1000`, pinHeaders());
    for (const r of res?.results || []) have.add(r.pin.cid);
  }
  return have;
}

async function pin(cid, name) {
  const res = await fetch(`${PIN_URL}/pins`, {
    method: 'POST',
    headers: pinHeaders(),
    body: JSON.stringify({ cid, name: name.slice(0, 255), origins: ORIGINS }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).status;
}

(async () => {
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
    console.log(`\nDRY RUN — would make sure these ${cids.length} CID(s) are pinned:`);
    for (const cid of cids) console.log(`  ${cid}  ${wanted.get(cid)}`);
    return;
  }

  const have = await alreadyPinned(cids);
  const missing = cids.filter(c => !have.has(c));
  console.log(`${cids.length} CID(s) total, ${have.size} already mirrored, ${missing.length} to pin`);

  let failed = 0;
  for (const cid of missing) {
    try {
      console.log(`  + ${cid}  ${wanted.get(cid)} -> ${await pin(cid, wanted.get(cid))}`);
    } catch (e) {
      failed++;
      console.error(`  ! ${cid}  ${e.message}`);
    }
    await sleep(300);
  }
  if (failed) { console.error(`${failed} pin request(s) failed`); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
