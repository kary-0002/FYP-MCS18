import { getApiBaseUrl } from "@/lib/api-url";

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);
  if (!response.ok)
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  return response;
}
export async function createSession(file: File) {
  const body = new FormData();
  body.append("veeg", file);
  return (await api("/upload", { method: "POST", body })).json();
}
export async function createSessionFromUrl(url: string, filename: string) {
  return (
    await api("/open-saved-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename }),
    })
  ).json();
}
export async function getSessionFile(id: string, filename: string) {
  const blob = await (await api(`/edf/${id}`)).blob();
  return new File([blob], filename || "recording.edf", {
    type: "application/octet-stream",
  });
}

/** Wait for queued Nicolet conversion, with two-second delays and 1,800 attempts. */
export async function waitForNicoletSourceJob(jobId: string) {
  const maxAttempts = 1800;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(
      `${getApiBaseUrl()}/source-job/${encodeURIComponent(jobId)}`,
    );
    if (!response.ok) {
      throw new Error(
        (await response.text()) || "Could not check Nicolet conversion status.",
      );
    }
    const result = await response.json();
    if (result.status === "completed") return result;
    if (result.status === "failed") {
      throw new Error(result.detail || "Nicolet conversion failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Nicolet conversion timed out.");
}

export type ProgressEvent = {
  id: number;
  message: string;
  status?: string;
};

export type AnalysisProgress = {
  percent: number | null;
  message: string;
  events: ProgressEvent[];
};

export function watchAnalysisProgress(
  sessionId: string,
  task: "seizure" | "background" | "report",
  onProgress: (progress: AnalysisProgress) => void,
) {
  let lastEventId = 0;
  let stopped = false;
  const poll = async () => {
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/analysis-progress/${sessionId}/${task}`,
      );
      if (!response.ok || stopped) return;
      const progress = (await response.json()) as AnalysisProgress;
      const events = (progress.events || []).filter((event) => {
        if (event.id <= lastEventId) return false;
        lastEventId = event.id;
        return true;
      });
      onProgress({ ...progress, events });
    } catch {
      // Progress is informational; the analysis request determines success.
    }
  };
  void poll();
  const timer = window.setInterval(() => void poll(), 700);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
