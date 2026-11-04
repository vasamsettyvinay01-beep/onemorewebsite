/**
 * Equal perceived weight: every mark gets the same visual area, then is clamped
 * to the shared box. Mirrors partnerBox in the shared edge-function helpers.
 */
export function partnerBox(width: number, height: number, box: { area: number; maxWidth: number; maxHeight: number }) {
  const ratio = width > 0 && height > 0 ? width / height : 2;
  let w = Math.sqrt(box.area * ratio);
  let h = w / ratio;
  const scale = Math.min(1, box.maxWidth / w, box.maxHeight / h);
  w *= scale;
  h *= scale;
  return { width: Math.round(w), height: Math.round(h) };
}
