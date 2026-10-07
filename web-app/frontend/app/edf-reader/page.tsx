"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { buildStoragePath, FILE_BUCKET, getRecordingPathsFromEdfPath } from "@/lib/files";

function EDFReaderContent() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get("file");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  const [savedFile, setSavedFile] = useState<{
    url: string;
    name: string;
    recordingState: unknown | null;
    statePath: string | null;
  } | null>(null);
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ blob: Blob; name: string; } | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [savingReport, setSavingReport] = useState(false);

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
    if (!reportUrl) return;
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reportUrl]);

  useEffect(() => {
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
        let recordingState: unknown | null = null;
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
        }
        if (!cancelled) {
          setSavedFile({
            url: data.signedUrl,
            name: row.original_name,
            recordingState,
            statePath: paths?.state ?? null
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
  }, [fileId]);

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
      const statePath = savedFile?.statePath;
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
    [savedFile?.statePath]
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
    const handleViewerMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "seizureai:viewer-ready") {
        syncTheme();
        return;
      }
      if (event.data?.type === "neuroscope:recording-state" && event.data?.state) {
        saveRecordingState(event.data.state);
        return;
      }
      if (event.data?.type === "seizureai:report-generated" && event.data?.blob) {
        setReport({ blob: event.data.blob as Blob, name: event.data.name || "eeg_report.pdf" });
        setReportStatus(null);
      }
    };
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("message", handleViewerMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", handleViewerMessage);
    };
  }, [syncTheme, saveRecordingState]);

  function downloadReport() {
    if (!reportUrl || !report) return;
    const link = document.createElement("a");
    link.href = reportUrl;
    link.download = report.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function saveReport() {
    if (!report) return;
    setReportStatus(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setReportStatus("Sign in to save this report to My Files.");
      return;
    }
    setSavingReport(true);
    const storagePath = buildStoragePath(user.id, "pdf", report.name);
    try {
      const { error: uploadError } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(storagePath, report.blob, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase
        .from("user_files")
        .insert({
          user_id: user.id,
          kind: "pdf",
          original_name: report.name,
          storage_path: storagePath,
          size_bytes: report.blob.size,
        });
      if (insertError) throw insertError;
      setReportStatus("Saved to My Files.");
    } catch (err) {
      setReportStatus(err instanceof Error ? err.message : "Could not save this report.");
    } finally {
      setSavingReport(false);
    }
  }

  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-8">
        <div className="section-kicker">Signal review and annotation</div>
        <h1 className="mb-4 text-3xl font-bold tracking-tight">EDF Viewer</h1>
        {fileId && !savedFile && !error && (
          <p className="mb-3 text-sm text-muted-foreground">Opening saved EDF file…</p>
        )}
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <iframe
          ref={frameRef}
          src="/neuroscope/"
          title="NeuroScope EDF viewer and annotator"
          className="h-[calc(100vh-10rem)] min-h-175 w-full border border-border bg-white"
          onLoad={handleFrameLoad}
        />
        {report && reportUrl && (
          <section ref={reportRef} className="mt-6 scroll-mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="section-kicker">Generated report</div>
                <h2 className="text-xl font-semibold">{report.name}</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadReport}>Download PDF</Button>
                <Button onClick={() => void saveReport()} disabled={savingReport}>
                  {savingReport ? "Saving..." : "Save to My Files"}
                </Button>
              </div>
            </div>
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
