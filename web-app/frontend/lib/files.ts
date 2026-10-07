export const FILE_BUCKET = "user-files";
export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const RECORDING_EDF_NAME = "recording.edf";
export const RECORDING_STATE_NAME = "recording_state.json";
export const LATEST_REPORT_NAME = "latest_report.pdf";

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

export function buildRecordingPaths(userId: string, recordingKey: string) {
  const folder = `${userId}/recordings/${recordingKey}`;
  return {
    folder,
    edf: `${folder}/${RECORDING_EDF_NAME}`,
    state: `${folder}/${RECORDING_STATE_NAME}`,
    report: `${folder}/${LATEST_REPORT_NAME}`
  };
}

export function getRecordingPathsFromEdfPath(edfPath: string) {
  if (!edfPath.endsWith(`/${RECORDING_EDF_NAME}`)) return null;
  const slash = edfPath.lastIndexOf("/");
  if (slash === -1) return null;
  const folder = edfPath.slice(0, slash);
  return {
    folder,
    edf: `${folder}/${RECORDING_EDF_NAME}`,
    state: `${folder}/${RECORDING_STATE_NAME}`,
    report: `${folder}/${LATEST_REPORT_NAME}`
  };
}