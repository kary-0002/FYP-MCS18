export const FILE_BUCKET = "user-files";
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export type FileKind = "edf" | "pdf";

export function classifyFile(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".edf")) return "edf";
  if (name.endsWith(".pdf")) return "pdf";
  return null;
}

export function storageFolder(kind: FileKind) {
  return kind === "edf" ? "edf" : "reports";
}

export function buildStoragePath(
  userId: string,
  kind: FileKind,
  fileName: string,
) {
  const safeName = fileName.replace(/[^\w.\-]+/g, "_");
  return `${userId}/${storageFolder(kind)}/${Date.now()}-${safeName}`;
}
