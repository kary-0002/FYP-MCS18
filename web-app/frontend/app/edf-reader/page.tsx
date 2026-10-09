"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { FILE_BUCKET, getRecordingPathsFromEdfPath,buildRecordingPaths, MAX_NICOLET_SOURCE_BYTES } from "@/lib/files";
import * as tus from "tus-js-client";

function getApiBaseUrl() {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    return "http://127.0.0.1:8000";
  }
  return "https://fyp-api.azutoro.com";
}

async function uploadResumableFile(file: File, storagePath: string, accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}` },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: FILE_BUCKET,
        objectName: storagePath,
        contentType: "application/octet-stream",
        cacheControl: "3600"
      },
      chunkSize: 6 * 1024 * 1024,
      onError(error) {
        reject(error);
      },
      onSuccess() {
        resolve();
      }
    });
    upload.start();
  });
}

async function waitForNicoletSourceJob(jobId: string) {
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    const response = await fetch(`${getApiBaseUrl()}/source-job/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error((await response.text()) || "Could not check Nicolet conversion status.");
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

function EDFReaderContent() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get("file");
  const router = useRouter();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  const [savedFile, setSavedFile] = useState<{
    url: string;
    name: string;
    recordingState: unknown | null;
    statePath: string | null;
    reportPath: string | null;
  } | null>(null);
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ blob: Blob; name: string; } | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [reportOutOfDate, setReportOutOfDate] = useState(false);
  const scrollToReportRef = useRef(false);
  const [savedBundle, setSavedBundle] = useState<{
    id: string;
    edfPath: string;
    statePath: string;
    reportPath: string;
  } | null>(null);
  const [viewerHasRecording, setViewerHasRecording] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [recordingSaveError, setRecordingSaveError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const latestRecordingStateRef = useRef<unknown | null>(null);
  const latestReportBlobRef = useRef<Blob | null>(null);
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const next = fileId
      ? `/edf-reader?file=${encodeURIComponent(fileId)}`
      : "/edf-reader";
    const loginUrl = `/login?next=${encodeURIComponent(next)}`;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      if (!user) {
        router.replace(loginUrl);
        return;
      }
      setIsSignedIn(true);
      setAuthChecked(true);
    });
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session?.user) {
        setIsSignedIn(false);
        router.replace(loginUrl);
        return;
      }
      setIsSignedIn(true);
      setAuthChecked(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fileId, router]);

  useEffect(() => {
    if (!report) {
      setReportUrl(null);
      return;
    }
    const url = URL.createObjectURL(report.blob);
    setReportUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [report]);

  useEffect(() => {
    if (!reportUrl || !scrollToReportRef.current) return;
    scrollToReportRef.current = false;
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reportUrl]);

  useEffect(() => {
    setReport(null);
    setReportOutOfDate(false);
    setReportStatus(null);
    setSavedBundle(null);
    setViewerHasRecording(false);
    setRecordingSaveError(null);
    latestRecordingStateRef.current = null;
    latestReportBlobRef.current = null;
    
    if (!authChecked || !isSignedIn) {
      setSavedFile(null);
      setError(null);
      return;
    }

    if (!fileId) {
      setSavedFile(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function prepareSavedFile() {
      try {
        const supabase = createClient();
        const { data: row, error: rowError } = await supabase
          .from("user_files")
          .select("original_name, storage_path, kind")
          .eq("id", fileId)
          .eq("kind", "edf")
          .single();

        if (rowError || !row) throw rowError ?? new Error("EDF file not found.");

        const { data, error: signedError } = await supabase.storage
          .from(FILE_BUCKET)
          .createSignedUrl(row.storage_path, 3600);

        if (signedError || !data?.signedUrl) {
          throw signedError ?? new Error("Could not open the saved EDF file.");
        }

        const paths = getRecordingPathsFromEdfPath(row.storage_path);
        let recordingState: Record<string, any> | null = null;
        let restoredReport: Blob | null = null;
        if (paths) {
          const { data: stateBlob, error: stateError } = await supabase.storage
            .from(FILE_BUCKET)
            .download(paths.state);
          if (stateBlob) {
            try {
              recordingState = JSON.parse(await stateBlob.text());
            } catch (err) {
              console.error("Could not parse recording state:", err);
            }
          } else if (stateError && !stateError.message.toLowerCase().includes("not found")) {
            console.warn("Could not load recording state:", stateError.message);
          }
          const { data: reportBlob, error: reportError } = await supabase.storage.from(FILE_BUCKET).download(paths.report);
          if (reportBlob) {
            restoredReport = reportBlob;
          } else if (reportError && !reportError.message.toLowerCase().includes("not found")) {
            console.warn("Could not load latest report:", reportError.message);
          }
        }
        if (!cancelled) {
          if (paths) {
            setSavedBundle({
              id: fileId!,
              edfPath: paths.edf,
              statePath: paths.state,
              reportPath: paths.report
            });
          }
          setReportOutOfDate(recordingState?.report?.outOfDate ?? false);
          if (restoredReport) {
            setReport({
              blob: restoredReport,
              name: `${row.original_name.replace(/\.edf$/i, "")}_report.pdf`
            });
          }
          setSavedFile({
            url: data.signedUrl,
            name: row.original_name,
            recordingState,
            statePath: paths?.state ?? null,
            reportPath: paths?.report ?? null
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open the saved EDF file.");
        }
      }
    }

    void prepareSavedFile();
    return () => { cancelled = true; };
  }, [fileId, authChecked, isSignedIn]);

  const sendSavedFile = useCallback(() => {
    if (!savedFile) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "neuroscope:open-edf",
        url: savedFile.url,
        name: savedFile.name,
        recordingState: savedFile.recordingState
      },
      window.location.origin
    );
  }, [savedFile]);

  const saveRecordingState = useCallback(
    (recordingState: unknown) => {
      const statePath = savedBundle?.statePath ?? savedFile?.statePath;
      if (!statePath) return;
      if (stateSaveTimerRef.current) {
        clearTimeout(stateSaveTimerRef.current);
      }
      stateSaveTimerRef.current = setTimeout(async () => {
        try {
          const blob = new Blob([JSON.stringify(recordingState, null, 2)], { type: "application/json" });
          const supabase = createClient();
          const { error: uploadError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(statePath, blob, { contentType: "application/json", upsert: true});
          if (uploadError) throw uploadError;
        } catch (err) {
          console.error("Could not save recording state:", err);
        }
      }, 500);
    },
    [savedBundle?.statePath, savedFile?.statePath]
  );

  const saveLatestReport = useCallback(
    async (blob: Blob) => {
      const reportPath = savedBundle?.reportPath ?? savedFile?.reportPath;
      if (!reportPath) return;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(reportPath, blob, {
          contentType: "application/pdf",
          upsert: true
        });
      if (error) throw error;
    },
    [savedBundle?.reportPath, savedFile?.reportPath]
  );

  const requestViewerSavePayload = useCallback(() => {
    return new Promise<{ file: File; state: unknown }>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", handler);
        reject(new Error("Timed out while preparing the recording for saving."));
      }, 30000);
      const handler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (
          event.data?.type !== "neuroscope:save-payload" ||
          event.data?.requestId !== requestId
        ) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener("message", handler);
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }
        if (!event.data.file || !event.data.state) {
          reject(new Error("Viewer did not return a complete recording."));
          return;
        }
        resolve({
          file: event.data.file as File,
          state: event.data.state
        });
      };
      window.addEventListener("message", handler);
      frameRef.current?.contentWindow?.postMessage(
        { type: "neuroscope:get-save-payload", requestId },
        window.location.origin
      );
    });
  }, []);

  const saveViewerRecording = useCallback(
    async (forceNew = false) => {
      if (saveInProgressRef.current) return;
      saveInProgressRef.current = true;
      setRecordingSaveError(null);
      setSavingRecording(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (!user || sessionError || !session?.access_token) {
          throw new Error("You must be signed in to use the EEG Viewer.");
        }
        const payload = await requestViewerSavePayload();
        latestRecordingStateRef.current = payload.state;
        // Existing recording: explicitly resync its mutable state/report.
        if (savedBundle && !forceNew) {
          const stateBlob = new Blob(
            [JSON.stringify(latestRecordingStateRef.current ?? payload.state, null, 2)],
            { type: "application/json" }
          );
          const { error: stateError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(savedBundle.statePath, stateBlob, {
              contentType: "application/json",
              upsert: true
            });
          if (stateError) throw stateError;
          const reportBlob = latestReportBlobRef.current ?? report?.blob ?? null;
          if (reportBlob) {
            const { error: reportError } = await supabase.storage
              .from(FILE_BUCKET)
              .upload(savedBundle.reportPath, reportBlob, {
                contentType: "application/pdf",
                upsert: true
              });
            if (reportError) throw reportError;
          }
          return;
        }
        // New locally opened EEG: automatically create a My Files bundle.
        const paths = buildRecordingPaths(user.id, crypto.randomUUID());
        const uploadedPaths: string[] = [];
        let bundleCreated = false;
        try {
          await uploadResumableFile(payload.file, paths.edf, session.access_token);
          uploadedPaths.push(paths.edf);
          const initialStateBlob = new Blob(
            [JSON.stringify(payload.state, null, 2)],
            { type: "application/json" }
          );
          const { error: stateError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(paths.state, initialStateBlob, {
              contentType: "application/json",
              upsert: false
            });
          if (stateError) throw stateError;
          uploadedPaths.push(paths.state);
          const { data: row, error: insertError } = await supabase
            .from("user_files")
            .insert({
              user_id: user.id,
              kind: "edf",
              original_name: payload.file.name,
              storage_path: paths.edf,
              size_bytes: payload.file.size
            })
            .select("id")
            .single();
          if (insertError || !row) {
            throw (insertError ?? new Error("Could not create the My Files entry."));
          }
          bundleCreated = true;
          const bundle = {
            id: row.id,
            edfPath: paths.edf,
            statePath: paths.state,
            reportPath: paths.report
          };
          setSavedBundle(bundle);
          // Analysis may have changed while the EDF was uploading.
          const latestState = latestRecordingStateRef.current ?? payload.state;
          const latestStateBlob = new Blob(
            [JSON.stringify(latestState, null, 2)],
            { type: "application/json" }
          );
          const { error: latestStateError } =
            await supabase.storage
              .from(FILE_BUCKET)
              .upload(paths.state, latestStateBlob, {
                contentType: "application/json",
                upsert: true
              });
          if (latestStateError) throw latestStateError;
          // A report may also have been generated during the upload.
          if (latestReportBlobRef.current) {
            const { error: reportError } =
              await supabase.storage
                .from(FILE_BUCKET)
                .upload(paths.report, latestReportBlobRef.current, {
                  contentType: "application/pdf",
                  upsert: true,
                });
            if (reportError) throw reportError;
          }
        } catch (err) {
          // Only remove the bundle if its database entry was never created.
          if (!bundleCreated && uploadedPaths.length) {
            await supabase.storage
              .from(FILE_BUCKET)
              .remove(uploadedPaths)
              .catch(() => {});
          }
          throw err;
        }
      } catch (err) {
        setRecordingSaveError(err instanceof Error ? err.message : "Could not save this recording.");
      } finally {
        saveInProgressRef.current = false;
        setSavingRecording(false);
      }
    },
    [report, requestViewerSavePayload, savedBundle]
  );

  const syncTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "seizureai:theme", dark: document.documentElement.classList.contains("dark") },
      window.location.origin,
    );
  }, []);

  const handleFrameLoad = useCallback(() => {
    syncTheme();
    sendSavedFile();
  }, [sendSavedFile, syncTheme]);

  useEffect(() => {
    sendSavedFile();
  }, [sendSavedFile]);

  useEffect(() => {
    const observer = new MutationObserver(syncTheme);
    const handleViewerMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "neuroscope:recording-opened") {
        setViewerHasRecording(true);
        if (!fileId) {
          // A newly opened local EEG is a new logical recording.
          setSavedBundle(null);
          setRecordingSaveError(null);
          setReport(null);
          setReportOutOfDate(false);
          setReportStatus(null);
          scrollToReportRef.current = false;
          latestRecordingStateRef.current = null;
          latestReportBlobRef.current = null;
          void saveViewerRecording(true);
        }
        return;
      }
      if (event.data?.type === "neuroscope:prepare-nicolet" && event.data?.file) {
        const requestId = event.data.requestId;
        const file = event.data.file as File;
        let sourcePath: string | null = null;
        try {
          if (!file.name.toLowerCase().endsWith(".e")) {
            throw new Error("Expected a Nicolet .e recording.");
          }
          if (file.size > MAX_NICOLET_SOURCE_BYTES) {
            throw new Error("Nicolet .e file is larger than the 5 GB limit.");
          }
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (!user || sessionError || !session?.access_token) {
            throw new Error("Sign in before opening a large Nicolet recording.");
          }
          const paths = buildRecordingPaths(user.id, crypto.randomUUID());
          sourcePath = paths.source;
          await uploadResumableFile(file, paths.source, session.access_token);
          const { data: signedSource, error: signedError } = await supabase.storage
            .from(FILE_BUCKET)
            .createSignedUrl(paths.source, 3600);
          if (signedError || !signedSource?.signedUrl) {
            throw signedError ?? new Error("Could not open uploaded Nicolet source.");
          }
          const startResponse = await fetch(
            `${getApiBaseUrl()}/open-saved-source`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: signedSource.signedUrl, filename: file.name })
            }
          );
          if (!startResponse.ok) {
            throw new Error((await startResponse.text()) || "Could not start Nicolet conversion.");
          }
          const startedJob = await startResponse.json();
          if (!startedJob.job_id) {
            throw new Error("Backend did not return a Nicolet conversion job.");
          }
          const result = await waitForNicoletSourceJob(startedJob.job_id);
          const { error: cleanupError } = await supabase.storage
            .from(FILE_BUCKET)
            .remove([paths.source]);
          if (cleanupError) {
            console.warn("Could not remove temporary Nicolet source:", cleanupError.message);
          }
          sourcePath = null;
          frameRef.current?.contentWindow?.postMessage(
            {
              type: "neuroscope:nicolet-ready",
              requestId,
              result
            },
            window.location.origin
          );
        } catch (err) {
          if (sourcePath) {
            const supabase = createClient();
            await supabase.storage
              .from(FILE_BUCKET)
              .remove([sourcePath])
              .catch(() => {});
          }
          frameRef.current?.contentWindow?.postMessage(
            {
              type: "neuroscope:nicolet-ready",
              requestId,
              error: err instanceof Error ? err.message : "Could not prepare Nicolet recording."
            },
            window.location.origin
          );
        }
        return;
      }
      if (event.data?.type === "seizureai:viewer-ready") {
        syncTheme();
        return;
      }
      if (event.data?.type === "neuroscope:recording-state" && event.data?.state) {
        latestRecordingStateRef.current = event.data.state;
        setReportOutOfDate(event.data.state?.report?.outOfDate ?? false);
        if (fileId || savedBundle) {
          saveRecordingState(event.data.state);
        }
        return;
      }
      if (event.data?.type === "seizureai:report-generated" && event.data?.blob) {
        const blob = event.data.blob as Blob;
        latestReportBlobRef.current = blob;
        scrollToReportRef.current = true;
        setReport({ blob, name: event.data.name || "eeg_report.pdf" });
        setReportOutOfDate(false);
        setReportStatus(null);
        if (fileId || savedBundle) {
          void saveLatestReport(blob).catch((err) => {
            console.error("Could not persist latest report:", err);
            setReportStatus(err instanceof Error ? err.message : "Could not save the report with this recording.");
          });
        }
        return;
      }
    };
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("message", handleViewerMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", handleViewerMessage);
    };
  }, [
    fileId,
    savedBundle,
    saveViewerRecording,
    syncTheme,
    saveRecordingState,
    saveLatestReport
  ]);

  function downloadReport() {
    if (!reportUrl || !report) return;
    const link = document.createElement("a");
    link.href = reportUrl;
    link.download = report.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!authChecked) {
    return (
      <div className="app-layout min-h-screen bg-background">
        <Header />
        <main className="px-4 py-8">
          <p className="text-sm text-muted-foreground">
            Checking sign-in status…
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-8">
        <div className="section-kicker">Signal review and annotation</div>
        <h1 className="mb-4 text-3xl font-bold tracking-tight">EEG Viewer</h1>
        {viewerHasRecording && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {savingRecording ? "Saving to My Files…" : fileId || savedBundle ? "Saved in My Files" : "Preparing to save…"}
            </span>
            {recordingSaveError && (
              <Button
                variant="outline"
                onClick={() => void saveViewerRecording(!fileId && !savedBundle)}
              >
                Retry Save
              </Button>
            )}
          </div>
        )}
        {recordingSaveError && (
          <p className="mb-3 text-sm text-destructive">
            {recordingSaveError}
          </p>
        )}
        {fileId && !savedFile && !error && (
          <p className="mb-3 text-sm text-muted-foreground">Opening saved EEG recording…</p>
        )}
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <iframe
          ref={frameRef}
          src="/neuroscope/"
          title="NeuroScope EEG viewer and annotator"
          className="h-[calc(100vh-10rem)] min-h-175 w-full border border-border bg-white"
          onLoad={handleFrameLoad}
        />
        {report && reportUrl && (
          <section ref={reportRef} className="mt-6 scroll-mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="section-kicker">Latest report</div>
                <h2 className="text-xl font-semibold">{report.name}</h2>
              </div>
              <Button variant="outline" onClick={downloadReport}>Download PDF</Button>
            </div>
            {reportOutOfDate && (
              <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                This report is out of date. Regenerate it to include the latest analysis results and annotations.
              </div>
            )}
            {reportStatus && (
              <p className="text-sm text-muted-foreground">
                {reportStatus}
              </p>
            )}
            <iframe
              src={reportUrl}
              title="Generated EEG report"
              className="h-[70vh] min-h-150 w-full border border-border bg-white"
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <EDFReaderContent />
    </Suspense>
  );
}
