#!/usr/bin/env node
// scripts/gen-push-text.js
//
// Copies the server-push notification texts from the app's translation files
// into functions/pushText.json, so the notifyNewComment Cloud Function can
// send each device's push in its own language. Run after translations change,
// then redeploy the function: node scripts/gen-push-text.js

const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const OUT = path.join(__dirname, '..', 'functions', 'pushText.json');

const text = {};
for (const lang of fs.readdirSync(LOCALES).filter(d => fs.statSync(path.join(LOCALES, d)).isDirectory()).sort()) {
  const file = path.join(LOCALES, lang, 'notifications.json');
  if (!fs.existsSync(file)) continue;
  const title = JSON.parse(fs.readFileSync(file, 'utf8'))?.push?.newComment?.title;
  if (title) text[lang] = { newCommentTitle: title };
}

if (!text.en) throw new Error('English push text missing');
fs.writeFileSync(OUT, JSON.stringify(text, null, 2) + '\n');
console.log(`Wrote push text for ${Object.keys(text).length} language(s): ${Object.keys(text).join(', ')}`);
