// src/lib/CardanoTxBuilder.ts
//
// Pure-JS Cardano metadata transaction builder.
// Replaces @emurgo/cardano-serialization-lib-asmjs entirely.
//
// Supports exactly what VoteBoxApp needs:
//   one-input / one-change-output / metadata-only transactions
//   signed by the Foundation ed25519 key.
//
// Dependencies (both pure JS, Metro-safe):
//   blakejs  — blake2b-256 (already in package.json)
//   tweetnacl — ed25519 sign
//   bech32   — Cardano address decode

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nacl    = require('tweetnacl')    as typeof import('tweetnacl');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blakejs = require('blakejs')      as typeof import('blakejs');
import { bech32 } from 'bech32';

// Pure JS hex utilities — Buffer is not available in Hermes/React Native
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Minimal CBOR encoder ─────────────────────────────────────────────────────
// Only the subset needed for Cardano transactions (definite-length only).

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function cborUint(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('cborUint: negative');
  if (n <= 23n)         return new Uint8Array([Number(n)]);
  if (n <= 0xffn)       return new Uint8Array([0x18, Number(n)]);
  if (n <= 0xffffn)     return new Uint8Array([0x19, Number(n >> 8n), Number(n & 0xffn)]);
  if (n <= 0xffffffffn) return new Uint8Array([
    0x1a,
    Number((n >> 24n) & 0xffn), Number((n >> 16n) & 0xffn),
    Number((n >>  8n) & 0xffn), Number( n         & 0xffn),
  ]);
  return new Uint8Array([
    0x1b,
    Number((n >> 56n) & 0xffn), Number((n >> 48n) & 0xffn),
    Number((n >> 40n) & 0xffn), Number((n >> 32n) & 0xffn),
    Number((n >> 24n) & 0xffn), Number((n >> 16n) & 0xffn),
    Number((n >>  8n) & 0xffn), Number( n         & 0xffn),
  ]);
}

function cborBytes(b: Uint8Array): Uint8Array {
  const l = b.length;
  if (l <= 23)    return concat(new Uint8Array([0x40 + l]), b);
  if (l <= 0xff)  return concat(new Uint8Array([0x58, l]), b);
  if (l <= 0xffff) return concat(new Uint8Array([0x59, l >> 8, l & 0xff]), b);
  throw new Error('cborBytes: too long');
}

function cborText(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const l   = enc.length;
  if (l > 64) throw new Error(`cborText: "${s.slice(0, 20)}…" exceeds 64-byte Cardano metadata limit`);
  if (l <= 23)   return concat(new Uint8Array([0x60 + l]), enc);
  if (l <= 0xff) return concat(new Uint8Array([0x78, l]), enc);
  throw new Error('cborText: too long');
}

function cborArray(items: Uint8Array[]): Uint8Array {
  const l = items.length;
  const hdr = l <= 23 ? new Uint8Array([0x80 + l]) : new Uint8Array([0x98, l]);
  return concat(hdr, ...items);
}

function cborMap(pairs: [Uint8Array, Uint8Array][]): Uint8Array {
  const l = pairs.length;
  const hdr = l <= 23 ? new Uint8Array([0xa0 + l]) : new Uint8Array([0xb8, l]);
  return concat(hdr, ...pairs.flatMap(([k, v]) => [k, v]));
}

// ─── Address decoding ─────────────────────────────────────────────────────────

function decodeAddress(bech32Addr: string): Uint8Array {
  const { words } = bech32.decode(bech32Addr, 200);
  return new Uint8Array(bech32.fromWords(words));
}

// ─── Metadata encoding ────────────────────────────────────────────────────────

function encodeAuxData(metadataObj: Record<number, Record<string, string>>): Uint8Array {
  const outerPairs: [Uint8Array, Uint8Array][] = [];
  for (const [labelStr, fields] of Object.entries(metadataObj)) {
    const innerPairs: [Uint8Array, Uint8Array][] = Object.entries(fields).map(([k, v]) => [
      cborText(k.slice(0, 64)),
      cborText(String(v).slice(0, 64)),
    ]);
    outerPairs.push([cborUint(BigInt(labelStr)), cborMap(innerPairs)]);
  }
  return cborMap(outerPairs);
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface CardanoTxResult {
  txBytes: Uint8Array; // signed CBOR bytes — POST body for Blockfrost /tx/submit
  txHash:  string;     // hex blake2b-256 of tx body — use as on-chain identifier
}

export interface CardanoTxParams {
  utxoTxHash:        string;   // hex-encoded 32-byte tx id
  utxoIndex:         number;
  utxoLovelace:      string;   // total lovelace in the UTxO (string to avoid precision loss)
  changeAddress:     string;   // bech32 change address (foundation wallet)
  privateKeyHex:     string;   // 32-byte ed25519 seed, hex-encoded
  metadata:          Record<number, Record<string, string>>;
  minFeeA:           number;   // lovelace per byte (from Blockfrost /epochs/latest/parameters)
  minFeeB:           number;   // base fee in lovelace
  currentSlot:       number;   // latest block slot (for TTL calculation)
}

// Builds a signed Cardano metadata transaction.
// Returns the raw CBOR bytes (for Blockfrost /tx/submit) and the tx hash.
export function buildSignedTx(params: CardanoTxParams): CardanoTxResult {
  const {
    utxoTxHash, utxoIndex, utxoLovelace,
    changeAddress, privateKeyHex,
    metadata, minFeeA, minFeeB, currentSlot,
  } = params;

  // ── Key pair from 32-byte seed ───────────────────────────────────────────
  const seed    = hexToBytes(privateKeyHex);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);

  // ── Auxiliary data ───────────────────────────────────────────────────────
  const auxDataCbor    = encodeAuxData(metadata);
  const auxDataHash    = blakejs.blake2b(auxDataCbor, undefined, 32) as Uint8Array;

  // ── Fee estimate (over-estimates by ~200 bytes as safety margin) ─────────
  const changeAddrBytes = decodeAddress(changeAddress);
  const estimatedBytes  = 60                      // tx overhead
    + 45                                          // 1 input
    + (changeAddrBytes.length + 12)               // 1 output (addr + value header)
    + auxDataCbor.length                          // metadata
    + 105                                         // vkey witness (pubkey 32 + sig 64 + headers)
    + 200;                                        // safety buffer
  const fee = BigInt(minFeeB) + BigInt(minFeeA) * BigInt(estimatedBytes);

  // ── Change output ────────────────────────────────────────────────────────
  const inputLovelace  = BigInt(utxoLovelace);
  if (inputLovelace <= fee) {
    throw new Error(`Foundation wallet insufficient: ${inputLovelace} lovelace ≤ fee ${fee}. Fund from preprod faucet.`);
  }
  const changeLovelace = inputLovelace - fee;

  // ── Transaction body ─────────────────────────────────────────────────────
  const txHashBytes  = hexToBytes(utxoTxHash);
  const encodedInput = cborArray([cborBytes(txHashBytes), cborUint(BigInt(utxoIndex))]);
  const encodedOutput = cborArray([cborBytes(changeAddrBytes), cborUint(changeLovelace)]);
  const ttl           = currentSlot + 7200; // 2 hours

  const txBodyCbor = cborMap([
    [cborUint(0n), cborArray([encodedInput])],   // inputs
    [cborUint(1n), cborArray([encodedOutput])],  // outputs
    [cborUint(2n), cborUint(fee)],               // fee
    [cborUint(3n), cborUint(BigInt(ttl))],       // ttl
    [cborUint(7n), cborBytes(auxDataHash)],      // auxiliary_data_hash
  ]);

  // ── Sign tx body hash ────────────────────────────────────────────────────
  const txBodyHash = blakejs.blake2b(txBodyCbor, undefined, 32) as Uint8Array;
  const signature  = nacl.sign.detached(txBodyHash, keyPair.secretKey);

  // ── Witness set ──────────────────────────────────────────────────────────
  const vkeyWitness = cborArray([
    cborBytes(keyPair.publicKey),
    cborBytes(signature),
  ]);
  const witnessCbor = cborMap([[cborUint(0n), cborArray([vkeyWitness])]]);

  // ── Full transaction: [body, witnesses, is_valid, aux_data] ──────────────
  const CBOR_TRUE = new Uint8Array([0xf5]);
  const txBytes   = cborArray([txBodyCbor, witnessCbor, CBOR_TRUE, auxDataCbor]);

  // Tx hash = hex(blake2b-256(tx_body_cbor)) — the on-chain identifier
  const txHash = bytesToHex(blakejs.blake2b(txBodyCbor, undefined, 32) as Uint8Array);

  return { txBytes, txHash };
}
