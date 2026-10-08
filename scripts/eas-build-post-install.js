#!/usr/bin/env node
// scripts/eas-build-post-install.js
//
// EAS build hook (package.json "eas-build-post-install"). For every profile
// except "development", leaves the dev-client modules out of native
// autolinking: they are only needed to connect a dev build to Metro, and
// expo-dev-launcher bundles Google's ML Kit QR scanner (~5 MB per CPU arch).

const fs = require('fs');
const path = require('path');

const profile = process.env.EAS_BUILD_PROFILE;
if (!profile || profile === 'development') {
  console.log(`[eas-build-post-install] profile "${profile}" — keeping expo-dev-client`);
  process.exit(0);
}

const DEV_MODULES = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.expo = pkg.expo || {};
pkg.expo.autolinking = pkg.expo.autolinking || {};
pkg.expo.autolinking.exclude = [...new Set([...(pkg.expo.autolinking.exclude || []), ...DEV_MODULES])];
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[eas-build-post-install] profile "${profile}" — excluded from autolinking: ${DEV_MODULES.join(', ')}`);
