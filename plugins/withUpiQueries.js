// Android 11+ hides other apps unless the manifest declares what we want to talk to.
// Declaring the "upi" scheme lets SplitIt open the chooser of installed UPI apps.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    const has = JSON.stringify(manifest.queries).includes('"android:scheme":"upi"');
    if (!has) {
      manifest.queries.push({
        intent: [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'upi' } }] }],
      });
    }
    return cfg;
  });
};
