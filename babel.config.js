// babel.config.js
//
// Needed because @walletconnect/modal-react-native pulls in `valtio` for
// internal state management, whose ESM build uses `import.meta` — a syntax
// Hermes (React Native's JS engine) doesn't support without this transform.
// Without it, EAS builds fail during the Metro bundling phase with:
// "SyntaxError: `import.meta` is not supported in Hermes."
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
    ],
  };
};
