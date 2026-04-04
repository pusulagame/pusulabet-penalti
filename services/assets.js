/** index.html ile aynı dizindeki assets/ — alt yol & Telegram WebView uyumu */
const _root = new URL('assets/', new URL('.', window.location.href));

export function assetUrl(subPath) {
  const p = String(subPath || '').replace(/^\/+/, '');
  return new URL(p, _root).href;
}
