/**
 * FBX harici dokuları (Image_1.jpg, Image_2.jpg …) repoda yoksa 404 olur;
 * Three.js yükleyicisi takılabiliyor veya tüm FBX başarısız sayılabiliyor.
 * Bu URL'leri 1×1 PNG data-URI ile değiştirerek yüklemeyi tamamlanır hale getirir.
 */
const PLACEHOLDER_TEX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function fbxResolveUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;

  // Windows mutlak yol (FBX içi): C:\...\file.jpg → dosya adı
  const win = url.match(/^(.*\/)([A-Za-z]:[/\\].+)$/);
  if (win) {
    const dir = win[1];
    const fn = win[2].replace(/\\/g, '/').split('/').pop();
    return dir + fn;
  }

  // 3ds Max / Blender: Image_2.jpg, image_1.png … (repoda olmayan harici doku)
  const pathOnly = url.split('?')[0].split('#')[0];
  if (/[\\/][Ii]mage_\d+\.(jpe?g|png|tga|bmp)$/i.test(pathOnly) || /^[Ii]mage_\d+\.(jpe?g|png|tga|bmp)$/i.test(pathOnly)) {
    return PLACEHOLDER_TEX;
  }

  return url;
}
