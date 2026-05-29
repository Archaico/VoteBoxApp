const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const CARDANO_MOCK = path.resolve(__dirname, 'src', 'mocks', 'cardano-mock.js');

// Intercept module resolution before Metro opens the real file.
// @emurgo/cardano-serialization-lib-asmjs is a ~15MB ASM.js blob that
// exhausts Metro's memory during dev bundling. The mock lets BlockchainService
// load without crashing — it already wraps the require() in try-catch.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@emurgo/cardano-serialization-lib-asmjs') {
    return { filePath: CARDANO_MOCK, type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
