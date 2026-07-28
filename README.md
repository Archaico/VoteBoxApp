# VoteBoxApp

**Open-source, blockchain-based direct democracy for communities.**

VoteBoxApp is a mobile governance platform built on Cardano and IPFS that enables
communities to create proposals and vote on them transparently — one person, one
vote, no token-weighting, no corporate platform dependency.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Status — What's Delivered](#status--whats-delivered)
- [Roadmap — What Funding Supports](#roadmap--what-funding-supports)
- [Sustainability](#sustainability)
- [Funding](#funding)
- [Contributing](#contributing)
- [License](#license)
- [Background](#background)
- [Contact](#contact)

---

## Features

- **One person, one vote** — no token-weighting, no wealth advantage, ever
- **On-chain proposals and votes** — every proposal and vote is a real Cardano
  transaction, publicly verifiable
- **IPFS content storage** — decentralised, censorship-resistant proposal and
  discussion data (via Pinata)
- **Free voting** — proposal creation costs a small ADA fee; voting is always free
- **Image attachments** — proposal creators can attach supporting images
- **Discussion threads** — per-proposal comments, synced across devices
- **Notifications** — deadline reminders, vote confirmations, and cross-device
  alerts for new comments and results, including while the app is closed
- **Offline-capable** — votes and comments queue locally and sync automatically
  when connectivity returns
- **Biometric authentication** — Expo LocalAuthentication for secure, private access
- **Shareable proposal links** — deep links that open the app directly if
  installed, or a live proposal preview page if not
- **Low-bandwidth design** — targets low-end Android hardware

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo SDK 54 (TypeScript) |
| Blockchain | Cardano (preprod testnet → mainnet at launch) |
| Cardano transactions | Pure-JS transaction builder (no native dependencies) |
| Chain reads | Blockfrost API |
| Content storage | IPFS via Pinata (`pinFileToIPFS` / `pinJSONToIPFS`), with public-gateway fallback chain |
| Cross-device comment discovery | Firebase Firestore (lightweight CID registry only — no user data) |
| Community integration | Discord (forum thread per proposal) |
| Notifications | Expo Notifications + background fetch |
| Auth | Expo LocalAuthentication + expo-secure-store |
| Distribution | GitHub Releases (public APK) + EAS Build |
| Smart Contracts | Aiken (Cardano validator language) — planned, not yet built |

---

## Project Structure

```
VoteBoxFresh/
├── index.ts               # Entry point
├── src/
│   ├── App.tsx             # Root component, navigation, deep-link handling
│   ├── screens/            # Splash, Auth, ProposalList, Voting, CreateProposal
│   ├── components/         # Reusable UI (ShareButton, QueueIndicator, etc.)
│   ├── services/           # BlockchainService, NotificationService,
│   │                       #   BackgroundSyncService, DiscordService,
│   │                       #   CIDRegistryService, ShareService,
│   │                       #   TreasuryService, OfflineQueueService,
│   │                       #   DiscussionService
│   └── lib/                # CardanoTxBuilder (pure-JS tx signing)
├── app.json                # Expo config, Android App Links
└── package.json
```

## Getting Started

```bash
git clone https://github.com/Archaico/VoteBoxApp.git
cd VoteBoxApp
npm install
npx expo start
```

Requires a `.env` file with Blockfrost, Pinata, and Firebase credentials — see
`.env.example`.

**Try it now:** download the latest Android build from
[GitHub Releases](https://github.com/Archaico/VoteBoxApp/releases/latest) —
no Play Store required.

---

## Status — What's Delivered

- [x] Core flow: create proposals, vote, view live results — all real Cardano
      transactions on preprod
- [x] IPFS storage for proposals, votes, and discussion threads
- [x] Cross-device sync — proposals, votes, comments, and image attachments
      all confirmed working across independent devices
- [x] Discord integration — auto-created forum thread per proposal
- [x] Notifications — local (vote confirmed, deadline reminders) and
      cross-device background sync (new comments, results when voting closes)
- [x] Offline queue — votes and comments survive connectivity loss
- [x] Voting closes automatically once a proposal's deadline passes
- [x] Public distribution — signed APK via GitHub Releases, no Play Store
      dependency
- [x] Shareable deep links — proposal-specific web preview page for
      non-installed users, App Links for installed users

## Roadmap — What Funding Supports

The core governance loop works end-to-end on testnet today. The remaining
work is what stands between this and a production-ready, trustworthy mainnet
platform communities can rely on:

**On-chain enforcement (Aiken smart contract)**
Proposal fees and the Perpetual Founder Fee are currently calculated and
tracked in application code — correct, but not yet *enforced* by the chain
itself. Writing and auditing an Aiken validator moves this enforcement
on-chain, where it's publicly verifiable and can't be altered by whoever runs
the app.

**Mainnet migration**
Moving from Cardano preprod to mainnet: wallet security review, transaction
fee finalisation, and a real ADA transfer path for the foundation fee
(currently recorded but not yet moved on-chain).

**User-controlled wallets**
Today, a foundation-operated wallet relays every transaction. Integrating
WalletConnect so proposal creators sign with their own wallet removes that
central point of trust.

**True push notifications**
Current notifications rely on the app periodically checking in the
background. Real push infrastructure (device token registry + delivery
server) means instant notifications even when the OS restricts background
activity.

**Internationalisation**
Infrastructure for 15-language support exists but isn't wired into the UI yet
— this is what makes the platform usable for non-English-speaking
communities, a core part of the project's global-access mission.

**Accessibility & low-bandwidth polish**
Skeleton loading states, and further testing on low-end hardware and slow
connections — essential for the rural and low-connectivity communities this
project is built for.

**Security review**
An independent audit before any mainnet deployment handling real funds.

---

## Sustainability

VoteBoxApp funds ongoing development through a protocol fee: proposal
creators pay a small ADA fee; voting is always free for everyone.

A fixed percentage of each proposal fee is allocated as a Perpetual Founder
Fee (PFF) to fund the original developer, with the remainder flowing to
project development and infrastructure costs. Once the Aiken validator above
is built, this allocation becomes an immutable, publicly auditable on-chain
constant — not a promise, an enforced rule.

Revenue comes from the protocol itself, not from proprietary code. The entire
codebase is AGPLv3 open source.

---

## Funding

VoteBoxApp has applied for funding from:

- **NLnet NGI Zero Commons Fund** — open internet infrastructure grant
- **Intersect MBO** (Cardano ecosystem grants) — rolling applications

If you would like to support the project directly:

- [Patreon — Life Ground Community](https://www.patreon.com/LifeGroundCommunity)
- Cardano ADA donations: contact lifegroundcommunity@gmail.com

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. All contributions are automatically licensed under AGPLv3.

---

## License

All source code in this repository is licensed under the
**GNU Affero General Public License v3.0 (AGPLv3)**.

This means you are free to use, modify, and distribute this software —
including for commercial purposes — provided that any modified version
offered as a network service is also published under AGPLv3.

See [LICENSE](LICENSE) for the full legal text.
See [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md) for documentation licensing
and protocol fee transparency notes.

---

## Background

VoteBoxApp is the technical realisation of
[*The Seed — Blueprint for a Better Society*](https://www.amazon.com/dp/B0CW1JHN26),
a framework for community-led governance written by the project founder.

---

## Contact

**Robert Rothe — Founder, Life Ground Community**
Email: lifegroundcommunity@gmail.com
Website: [voteboxapp.org](https://voteboxapp.org)
X: [@TheLifeGround](https://x.com/TheLifeGround)
