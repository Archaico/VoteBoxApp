// src/services/WalletConnectService.ts
//
// Real Cardano wallet connection via WalletConnect v2 (CIP-34 namespace).
// Replaces the old "paste your address" flow — the address now comes
// directly from the connected wallet's own session (via the
// useWalletConnectModal hook, which owns the WalletConnect provider
// lifecycle), and ownership is additionally proven via a signed challenge
// message (cardano_signData).
//
// This file is deliberately stateless — it does NOT construct its own
// UniversalProvider. The `useWalletConnectModal` hook (from
// @walletconnect/modal-react-native) already owns one provider instance
// for the whole app; a second, independently-constructed provider here
// would silently desync from the hook's connection state. Callers pass in
// the hook's `provider` when they need to make a request.
//
// Scope note: this proves the wallet cooperated in signing — it does NOT
// yet cryptographically re-verify the returned COSE_Sign1 signature against
// the address's key (that's a real hardening step, deliberately deferred).
//
// Foundation wallet still signs and pays for the actual proposal/vote
// transactions (Option A scope) — this only establishes and proves a real
// connection to the creator's own wallet.

// Preprod testnet. Mainnet chain id is 'cip34:1-764824073'.
export const CARDANO_PREPROD = 'cip34:0-1';

export const CIP34_NAMESPACE = {
  cip34: {
    chains: [CARDANO_PREPROD],
    methods: ['cardano_signData', 'cardano_signTx'],
    events: ['accountsChanged', 'chainChanged'],
  },
};

export interface WalletConnectResult {
  address: string;
  signature: string; // hex-encoded COSE_Sign1 signature from cardano_signData
}

// Minimal shape we actually use — deliberately NOT importing IUniversalProvider
// here. @walletconnect/modal-react-native bundles its own nested copy of
// @walletconnect/universal-provider, which TypeScript treats as a distinct,
// structurally-incompatible type from the top-level package. The runtime
// object from useWalletConnectModal()'s `provider` is fine; only the
// duplicate type identity is the problem.
interface RequestCapableProvider {
  request: (args: { method: string; params?: any }, chainId?: string) => Promise<unknown>;
}

// Requests a signature over a fresh challenge message, proving the
// connected wallet actually holds the signing key for `address` — a
// random/fake address could never produce this, since it requires the
// real wallet app to cooperate and the user to approve in-app.
export async function verifyWalletOwnership(
  provider: RequestCapableProvider,
  address: string
): Promise<WalletConnectResult> {
  const challenge = `VoteBoxApp wallet verification\naddress: ${address}\nnonce: ${Date.now()}`;
  const payloadHex = Buffer.from(challenge, 'utf8').toString('hex');

  const result = await provider.request(
    {
      method: 'cardano_signData',
      params: { address, payload: payloadHex },
    },
    CARDANO_PREPROD
  );

  const signature = (result as any)?.signature ?? (result as string);
  if (!signature) throw new Error('Wallet did not return a signature');

  return { address, signature };
}
