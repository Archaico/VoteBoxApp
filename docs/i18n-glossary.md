# VoteBoxApp — translation glossary

Shared rules for every translation of the app. English (`src/i18n/locales/en/`)
is the source of truth. Native-speaker review of the **core terms** below is
recommended before a public release, because they carry legal and civic weight.

## What VoteBoxApp is

A free, open-source direct-democracy app. Communities create **proposals** and
**vote** on them. Each vote is one person, one vote, and voting is always free.
Votes and proposals are recorded on the **Cardano** blockchain; discussions are
stored on **IPFS**. A proposal's creator pays a small fee in **ADA** (Cardano's
currency) to publish it. The app currently runs on Cardano's **testnet**
("preprod"), so the ADA used is free test money.

Audience: ordinary people worldwide, including rural and low-connectivity
communities, often not technical. Use clear, plain, respectful language.

## Tone and form of address

- Plain and friendly, never bureaucratic or legalistic. Short sentences.
- Address the user the way **modern, widely used mobile apps in that language**
  do (e.g. German "du", French "vous", Spanish "tú", Dutch "je", Brazilian
  Portuguese "você", European Portuguese — prefer impersonal or "você" phrasing
  common in apps there). Pick one form per language and use it **consistently**.
- Keep the meaning, not the word order. Translate naturally.

## Never translate

- Brand and network names: **VoteBoxApp**, **Cardano**, **ADA**, **IPFS**,
  **Pinata**, **Discord**, **Vespr**, **Eternl**, **Lace**, **WalletConnect**,
  **LifeGround Community (LGC)**, **Blockfrost**.
- Technical identifiers: `addr_test1…`, transaction hashes, URLs.
- Placeholders: everything inside `{{…}}` stays exactly as written
  (e.g. `{{count}}`, `{{title}}`). Move them to wherever the grammar needs.
- Tags like `<bold>…</bold>`: keep the tag names, translate the text inside.
- Emoji: keep them, in a sensible position.

## Core terms — translate consistently

| English | Meaning in this app |
|---|---|
| proposal | A question or idea put to the community for a decision. Use the word your language uses for a motion/proposal in a civic or community assembly, not a business offer. |
| vote (noun / verb) | One person's choice on a proposal, and the act of choosing. |
| Yes / No / Abstain | The three vote options. "Abstain" = formally choosing not to support either side (civic voting term). |
| voter | A person who votes. |
| creator | The person who created the proposal. |
| deadline / voting closes | When voting on a proposal ends. |
| results | The vote counts after (or during) voting. |
| discussion / comment | The comment thread attached to each proposal. |
| fee | The small payment a creator makes to publish a proposal. |
| Foundation wallet | The community foundation's Cardano wallet that receives fees. Translate "Foundation"; keep "wallet" as your language's usual crypto-wallet term. |
| wallet / wallet address | A Cardano crypto wallet and its address. |
| transaction / transaction hash | A blockchain transaction and its unique ID. Use the established crypto term in your language (often a loan-word). |
| blockchain | Use your language's established term (often unchanged). |
| testnet | Cardano's test network. Often left as "testnet". |
| publish | Making a proposal live for voting. |
| subscribe / notifications | Getting alerts about proposals you follow. |

## Plurals

Keys ending in `_one`, `_other` (etc.) are plural forms. Provide **exactly the
plural forms your language needs** under CLDR rules — for example:

| Language | Forms |
|---|---|
| en, de, nl, sv, nb, da, fi, el, hi, bn, sw, ha | `_one`, `_other` |
| es, fr, it, pt-BR, pt-PT | `_one`, `_many`, `_other` (`_many` is for very large round numbers, e.g. "1 million"; usually the same text as `_other`) |
| ru, pl | `_one`, `_few`, `_many`, `_other` |
| ar | `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` |
| zh-Hans, ja, ko | `_other` only |

Run `node scripts/check-i18n.js` — it validates keys, plural forms and
placeholders for every language.
