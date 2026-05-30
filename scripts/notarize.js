// Placeholder notarization script — configure in Phase 6 before distribution.
// electron-builder calls this as afterSign hook.
exports.default = async function notarize(_context) {
  // Phase 6: use @electron/notarize with Apple ID / App Store Connect API key.
  console.warn('Notarization not configured — skipping (Phase 6 task)')
}
