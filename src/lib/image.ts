/**
 * A photo from the phone, made small enough to keep in a setting.
 *
 * The PromptPay QR is read with the settings on every repaint of the sell
 * screen, so a 4 MB camera photo would be carried around all day. 720 px on
 * the long side is still far more than a QR needs to scan from a screen.
 * Falls back to the original if the browser cannot decode or draw it.
 */
export async function imageToDataUrl(file: Blob, maxSide = 720): Promise<string> {
  const original = await readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return original;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const scaled = canvas.toDataURL('image/jpeg', 0.92);
    return scaled.length < original.length ? scaled : original;
  } catch {
    return original;
  }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the image'));
    reader.readAsDataURL(file);
  });
}
