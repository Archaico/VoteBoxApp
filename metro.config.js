const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Cardano transaction building uses pure-JS (CardanoTxBuilder.ts).
// @emurgo/cardano-serialization-lib-asmjs is no longer imported anywhere.

module.exports = config;
