/**
 * Centre-crop an uploaded image to a `px` square and encode it small enough to
 * live on a server row (a vault's icon, a profile picture): PNG keeps a logo's
 * transparency, and a photo that comes out too large as PNG falls back to JPEG.
 */
export async function imageFileToSquareDataUrl(
  file: File,
  px: number,
  maxChars: number,
): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("읽을 수 없는 이미지 파일이에요.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리하지 못했어요.");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close();
  const png = canvas.toDataURL("image/png");
  if (png.length <= maxChars) return png;
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  if (jpeg.length <= maxChars) return jpeg;
  throw new Error("이미지가 너무 복잡해서 사용할 수 없어요. 더 단순한 이미지를 써 보세요.");
}
