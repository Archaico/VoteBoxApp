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
- [Languages & Translations](#languages--translations)
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
- **Notifications** — deadline reminders, vote confirmations, and real push
  notifications for new comments on proposals you follow, across devices
- **23 languages** — the app follows the phone's language, with a manual
  language picker (including right-to-left Arabic)
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
| Notifications | Expo Notifications + push via Firebase Cloud Functions |
| Languages | i18next + react-i18next (23 languages) |
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
│   ├── i18n/               # Language setup + translations (locales/<lang>/*.json)
│   └── lib/                # CardanoTxBuilder (pure-JS tx signing)
├── docs/                   # Translation glossary and review notes
├── scripts/                # check-i18n.js and locale generators
├── functions/              # Firebase Cloud Function (push notifications)
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
- [x] Notifications — local (vote confirmed, deadline reminders) and real
      cross-device push for new comments, in each device's own language
- [x] Proposal fees paid by the creator — the app verifies the payment
      on-chain before publishing, and a payment can only be used once
- [x] Founder fee paid out on-chain in batches, with every contributing
      proposal itemised in the transaction metadata
- [x] 23 languages (AI-translated, awaiting native-speaker review — see
      [Languages & Translations](#languages--translations))
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
fee finalisation, and moving the foundation's signing key out of the app
build.

**User-controlled wallets**
Today, a foundation-operated wallet relays every transaction. Integrating
WalletConnect so proposal creators sign with their own wallet removes that
central point of trust.

**Native-speaker translation review**
The app is translated into 23 languages, but the translations have not yet
been reviewed by native speakers. Reviewing them — especially the voting
terms — is what makes the platform trustworthy for non-English-speaking
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

## Languages & Translations

VoteBoxApp is available in **English** plus **22 languages**: Arabic, Bengali,
Chinese (Simplified), Danish, Dutch, Finnish, French, German, Greek, Hausa,
Hindi, Italian, Japanese, Korean, Norwegian, Polish, Portuguese (Brazil),
Portuguese (Portugal), Russian, Spanish, Swahili and Swedish.

> **Note:** these translations were produced with AI assistance and **have not
> yet been reviewed by native speakers.** Some wording — particularly voting
> terms such as "Abstain" — may be inaccurate or unnatural.

**Help us get it right.** If you speak one of these languages, we would love
your help reviewing it, or adding a new one. No coding needed:

- Translations live in [`src/i18n/locales/<language>/`](src/i18n/locales) as
  plain JSON files.
- [`docs/i18n-review-notes.md`](docs/i18n-review-notes.md) lists the choices
  the translators were unsure about, per language — a good place to start.
- [`docs/i18n-glossary.md`](docs/i18n-glossary.md) explains the key terms and
  tone.

Open an issue or pull request, or email **lifegroundcommunity@gmail.com** —
we're happy to help you get started.

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
