const EXTENSIONS: Record<string, string> = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
};

export function imageExtension(source: string): string {
  const mime = /^data:image\/([^;,]+)/i.exec(source)?.[1]?.toLowerCase();
  return (mime && EXTENSIONS[mime]) || "png";
}

export function imageDownloadName(
  label: string,
  source: string,
  now: Date = new Date(),
): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const safeLabel =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "image";
  return `diffusatory-${safeLabel}-${stamp}.${imageExtension(source)}`;
}

export function saveImage(source: string, label: string = "image"): void {
  const anchor = document.createElement("a");
  anchor.href = source;
  anchor.download = imageDownloadName(label, source);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
