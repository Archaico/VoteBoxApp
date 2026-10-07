#!/usr/bin/env node
// scripts/check-i18n.js
//
// Translation consistency check. Run: node scripts/check-i18n.js
//  1. Every language has the same keys as English, per namespace.
//  2. Every translation keeps the same {{placeholders}} as English.
//  3. Every t('ns:key') / t('key') used in src/ exists in English.
//  4. Lists JSX text that still looks hardcoded (heuristic — review by eye).
// Exits non-zero if 1–3 find problems.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'src', 'i18n', 'locales');
const SRC = path.join(ROOT, 'src');

const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flatten(v, key));
    else acc[key] = String(v);
    return acc;
  }, {});

const placeholders = s => (s.match(/\{\{\s*[\w.]+\s*\}\}/g) || []).map(p => p.replace(/\s/g, '')).sort().join(',');

const readNs = lang =>
  Object.fromEntries(
    fs.readdirSync(path.join(LOCALES, lang))
      .filter(f => f.endsWith('.json'))
      .map(f => [f.replace('.json', ''), flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lang, f), 'utf8')))])
  );

let errors = 0;
const fail = msg => { errors++; console.log('  ✗ ' + msg); };

const en = readNs('en');
const langs = fs.readdirSync(LOCALES).filter(d => fs.statSync(path.join(LOCALES, d)).isDirectory() && d !== 'en');

console.log(`English: ${Object.values(en).reduce((n, ns) => n + Object.keys(ns).length, 0)} strings in ${Object.keys(en).length} namespaces`);

// 1 + 2
for (const lang of langs) {
  console.log(`\n[${lang}]`);
  const tr = readNs(lang);
  for (const [ns, keys] of Object.entries(en)) {
    const t = tr[ns] || {};
    for (const key of Object.keys(keys)) {
      if (!(key in t)) fail(`${ns}:${key} missing`);
      else if (placeholders(t[key]) !== placeholders(keys[key])) fail(`${ns}:${key} placeholders differ (${placeholders(keys[key])} vs ${placeholders(t[key])})`);
    }
    for (const key of Object.keys(t)) if (!(key in keys)) fail(`${ns}:${key} not in English`);
  }
}

// 3 + 4
const files = [];
const walk = dir => fs.readdirSync(dir).forEach(f => {
  const p = path.join(dir, f);
  if (fs.statSync(p).isDirectory()) { if (!p.includes(`${path.sep}i18n`)) walk(p); }
  else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
});
walk(SRC);

console.log('\n[keys used in code]');
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const nsMatch = src.match(/useTranslation\(\s*['"](\w+)['"]/) || src.match(/getFixedT\([^,]*,\s*['"](\w+)['"]/);
  const defaultNs = nsMatch ? nsMatch[1] : 'common';
  for (const m of src.matchAll(/\bt\(\s*['"]([\w.:-]+)['"]/g)) {
    const [ns, key] = m[1].includes(':') ? m[1].split(':') : [defaultNs, m[1]];
    if (!en[ns] || !(key in en[ns]) && !Object.keys(en[ns]).some(k => k.startsWith(key + '_'))) {
      fail(`${path.relative(ROOT, file)}: '${m[1]}' not found in en/${ns}.json`);
    }
  }
}

console.log('\n[possibly hardcoded UI text — review]');
for (const file of files.filter(f => /\.tsx$/.test(f))) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = [...src.matchAll(/>\s*([A-Za-z][^<>{}]*[A-Za-z][^<>{}]*)\s*</g)].map(m => m[1].trim()).filter(s => s.length > 1);
  hits.forEach(h => console.log(`  · ${path.relative(ROOT, file)}: "${h.slice(0, 70)}"`));
}

console.log(errors ? `\n${errors} problem(s) found.` : '\nAll translation checks passed.');
process.exit(errors ? 1 : 0);
