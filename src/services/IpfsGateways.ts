// src/services/IpfsGateways.ts
//
// One place for every IPFS read gateway the app uses, plus a staggered race
// that fetches JSON through them.
//
// Pinata is the primary provider (it uploads and pins everything). The other
// gateways are independent fallbacks so a slow or failing gateway never
// blocks a read. ipfs.io and dweb.link were removed: Shipyard retired them
// for apps on 21 Sep 2026. Storage redundancy (a second pinned copy) is a
// separate job, done off-phone by the mirror script.

// Our own Pinata gateway — fastest, but metered (monthly bandwidth limit).
// Serves our own pins without a key, so no secret is sent on reads.
const PINATA_DEDICATED = 'https://magenta-important-scorpion-739.mypinata.cloud/ipfs';
const PINATA_PUBLIC    = 'https://gateway.pinata.cloud/ipfs';
const IPFS_LENS        = 'https://gw.ipfs-lens.dev/ipfs';
const FILEBASE         = 'https://ipfs.filebase.io/ipfs';

// JSON (proposals, comment threads): small files, so the metered gateway goes first.
const JSON_GATEWAYS = [PINATA_DEDICATED, IPFS_LENS, FILEBASE, PINATA_PUBLIC];

// Images: read-heavy (viral shares), so free gateways first and the metered
// one is the last resort.
const IMAGE_GATEWAYS = [IPFS_LENS, FILEBASE, PINATA_PUBLIC, PINATA_DEDICATED];

// Start the next gateway if the current ones haven't answered by then.
const STAGGER_MS = 1500;
const TIMEOUT_MS = 8000;

export function getImageUrls(cid: string): string[] {
  return IMAGE_GATEWAYS.map(g => `${g}/${cid}`);
}

// Fetches JSON for a CID. The first gateway starts at once, the next one
// joins every STAGGER_MS (or immediately when one fails), and the first
// response that passes `accept` wins; the others are cancelled.
// `accept` guards against a gateway returning the wrong or broken content.
export function fetchIpfsJson<T>(cid: string, accept: (data: any) => boolean): Promise<T | null> {
  return new Promise(resolve => {
    const controllers: AbortController[] = [];
    let next = 0;
    let running = 0;
    let done = false;
    let stagger: ReturnType<typeof setInterval> | undefined;

    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      clearInterval(stagger);
      controllers.forEach(c => c.abort());
      resolve(value);
    };

    // AbortSignal.timeout() is not available in Hermes — use AbortController instead
    const launch = () => {
      if (done || next >= JSON_GATEWAYS.length) return;
      const url = `${JSON_GATEWAYS[next++]}/${cid}`;
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      running++;

      fetch(url, { signal: controller.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data && accept(data)) finish(data as T); })
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer);
          running--;
          if (done) return;
          if (next < JSON_GATEWAYS.length) launch();
          else if (running === 0) finish(null);
        });
    };

    launch();
    stagger = setInterval(launch, STAGGER_MS);
  });
}
