// Substituted for @emurgo/cardano-serialization-lib-asmjs in dev builds only.
// The real library is ~15MB of ASM.js and exhausts Metro's memory during bundling.
// BlockchainService wraps its require() in try-catch so this gracefully disables
// Cardano transaction building without crashing the app.
module.exports = {};
