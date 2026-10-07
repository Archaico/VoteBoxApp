# VoteBoxApp — notes for native-speaker reviewers

The app's translations were produced in October 2026 by AI translators following
[`i18n-glossary.md`](i18n-glossary.md). Before a public release, a native speaker
should review each language — especially the **core voting terms** (proposal,
Yes / No / Abstain, PASSED) and the choices listed below, which the translators
flagged as judgement calls.

Translation files: `src/i18n/locales/<language>/*.json`.
Check after editing: `node scripts/check-i18n.js`.

## Spanish, French, Italian, Portuguese (es, fr, it, pt-BR, pt-PT)

- **Form of address:** es "tú" (neutral Latin-American Spanish); fr "vous"; it "tu";
  pt-BR "você"; pt-PT formal without pronoun ("Introduza", "o seu").
- **Regional vocabulary:** es billetera, costo, celular. pt-BR celular, baixar,
  compartilhar. pt-PT telemóvel, transferir, partilhar, registo.
- **Number format:** fr, it, pt use decimal comma (1,2 ADA); es keeps 1.2.
- **wallet:** es billetera (Spain: cartera/monedero), fr portefeuille,
  it "wallet" (alt. portafoglio), pt carteira.
- **gas costs:** "gas" kept as loan-word in all five.
- **Abstain:** Abstención / Abstention / Astensione / Abstenção.
- **proposal:** propuesta / proposition / proposta / proposta.
- **fee:** tarifa / frais / commissione / taxa.
- **Proposal PASSED:** APROBADA / ADOPTÉE / APPROVATA / APROVADA.
- **Proposal ended:** fr and it say "vote ended" rather than "proposal ended".
- **Authenticate to Vote:** es "Identifícate para votar", fr "S'identifier pour
  voter", it "Accedi per votare", pt-BR "Entrar para votar", pt-PT "Autenticar
  para votar".
- **Brand gender in Portuguese:** pt-PT feminine ("a VoteBoxApp", as for
  "aplicação"); pt-BR masculine ("o VoteBoxApp", as for "o app").
- Share-button labels were shortened to fit (e.g. es "Compartir: cierra pronto").

## German, Dutch, Swedish, Norwegian, Danish (de, nl, sv, nb, da)

- **Form of address:** de "du"; nl "je/jouw"; sv, nb, da "du". Sentence case
  throughout (not English title case).
- **proposal:** de "Vorschlag" (chosen over the more formal "Antrag");
  nl "voorstel"; sv "förslag"; nb/da "forslag".
- **Abstain:** de "Enthaltung"; nl "Onthouding"; sv/nb "Avstår";
  da "Undlader" (alt. "Hverken for eller imod").
- **voter:** de gender-neutral "Teilnehmende" / "Person(en)" instead of "Wähler".
- **wallet:** de/nl loan-word "Wallet"; sv plånbok, nb lommebok, da tegnebog
  (da least certain — "wallet" is also common).
- **Foundation fee:** de Stiftungsgebühr; nl "Bijdrage stichting";
  sv Stiftelseavgift; nb Stiftelsesgebyr; da Fondsgebyr.
- **blockchain:** de/nl/da "Blockchain"; sv "blockkedja"; nb "blokkjede".
- **Authenticate to Vote:** rendered as "unlock to vote" (e.g. de "Entsperren
  und abstimmen").
- **Proposal PASSED:** ANGENOMMEN / AANGENOMEN / ANTOGS / VEDTATT / VEDTAGET.
- Wallet setup step "a few dollars" localised to euros (de, nl) and kroner
  (nb, da; sv "några tior").

## Chinese (Simplified), Japanese, Korean (zh-Hans, ja, ko)

- **Register:** zh informal 你 (swap to formal 您 is a global change if
  preferred); ja です/ます; ko 해요체 (as in Toss/Kakao).
- **proposal:** 提案 / 提案 / 제안 (ko alt. 안건).
- **Yes / No / Abstain:** 赞成/反对/弃权 · 賛成/反対/棄権 · 찬성/반대/기권.
- **Proposal PASSED:** 已通过 / 可決 / 가결.
- **transaction hash:** 交易哈希 / トランザクションハッシュ / 트랜잭션 해시.
- **recovery phrase:** 助记词 / リカバリーフレーズ / 복구 문구.
- **Discussion tab:** 讨论 / ディスカッション / 토론 (ja alt. 議論 or コメント).
- **Tagline** "Your voice. Your vote. No barriers." rendered fairly freely in all
  three — worth a look.
- **ko:** share messages use 당신 ("you"), which Korean often avoids —
  may want rephrasing. "Share That You Voted" → 투표 인증 공유.

## Finnish, Polish, Greek, Russian (fi, pl, el, ru)

- **Form of address:** fi informal "sinä"; pl informal "ty" with gender-neutral
  wording where a past-tense verb would reveal gender; el informal "εσύ";
  ru polite "вы" (usual in Russian apps).
- **Hours/days countdown in share text:** pl and ru use a colon form
  ("DO KOŃCA GŁOSOWANIA: {{count}} GODZ.") so the noun needn't agree with the
  number — check it reads naturally.
- **proposal:** fi ehdotus; pl propozycja (alt. the more formal "wniosek");
  el πρόταση; ru предложение.
- **Abstain:** fi "Tyhjä" (parliamentary "blank vote"); pl "Wstrzymuję się";
  el "Αποχή"; ru "Воздержаться".
- **Foundation fee:** fi Säätiön maksu; pl Opłata fundacji; el Τέλος Ιδρύματος;
  ru Сбор Фонда.
- **"I just voted" share heading:** pl and ru rewritten gender-neutrally as
  "My vote is already on VoteBoxApp".
- **Proposal PASSED:** HYVÄKSYTTY / PRZYJĘTA / ΕΓΚΡΙΘΗΚΕ / ПРИНЯТО.
- **Duration abbreviations:** fi pv/h/min; pl d/godz./min (pl "d" least
  certain); el ημ./ώρ./λεπ.; ru д/ч/мин.
- Wallet-app menu labels ("Receive", "Address") are translated, though the
  wallet apps themselves may show them in English.

## Arabic, Hindi, Bengali, Swahili, Hausa (ar, hi, bn, sw, ha)

- **Form of address:** ar MSA, masculine-singular imperative (as most Arabic
  apps); hi आप; bn আপনি; sw singular "wewe"; ha respectful plural "ku"
  (avoids gendered ka/ki).
- **Arabic layout:** right-to-left; back arrows point right ("→ رجوع").
  "Hours/days left" uses a label form ("الساعات المتبقية للتصويت: {{count}}").
  Gas → رسوم الشبكة ("network fees").
- **Arabic terms:** proposal مقترح; Abstain امتناع; voter مصوّت; transaction
  hash معرّف المعاملة; blockchain البلوكتشين; Foundation المؤسسة;
  "I voted" أدليت بصوتي.
- **Hindi:** Abstain तटस्थ ("neutral"; alt. मतदान से परहेज़); transaction
  ट्रांज़ैक्शन (loan-word, not लेन-देन); Foundation fee फ़ाउंडेशन शुल्क.
- **Bengali:** Abstain বিরত; Recommended সুপারিশকৃত (avoids প্রস্তাবিত, which
  clashes with প্রস্তাব "proposal"); Western digits throughout.
- **Swahili:** proposal pendekezo/mapendekezo; **Abstain "Sina upande"
  ("I take no side") — most uncertain** (alt. "Najizuia", "Sipigi kura");
  wallet "wallet" (alt. "pochi", familiar from M-Pesa); transaction muamala;
  Foundation Taasisi (alt. Wakfu); gas "Ada za mtandao (gas)".
- **Hausa:** proposal ƙuduri/ƙudurori (BBC Hausa usage for motion/bill);
  **Abstain "Ƙauracewa" — most uncertain, can read as "boycott"**
  (alt. "Tsaka-tsaki", "Ban zaɓi kowa ba"); vote ƙuri'a / kaɗa ƙuri'a;
  wallet walat; Foundation Gidauniya; decentralised "Babu Mai Iko Ɗaya"
  ("no single authority").

**Priority for review:** the Abstain option in Swahili and Hausa, and Arabic
layout as a whole.
