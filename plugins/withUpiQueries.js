// Android 11+ only lets apps see other apps they declare. Declare the upi:// scheme so
// Linking.canOpenURL finds installed UPI apps (GPay, PhonePe, Paytm, BHIM...).
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const q = manifest.queries[0];
    q.intent = q.intent ?? [];
    const has = q.intent.some((i) => i.data?.some((d) => d.$?.['android:scheme'] === 'upi'));
    if (!has) {
      q.intent.push({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'upi' } }] });
    }
    return cfg;
  });
};
