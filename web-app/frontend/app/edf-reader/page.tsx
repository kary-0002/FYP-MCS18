"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import {
  PatientAssignmentDialog,
  type PatientSummary,
} from "@/components/patient-assignment-dialog";
import { createClient } from "@/lib/supabase/client";
import { getApiBaseUrl } from "@/lib/api-url";
import {
  FILE_BUCKET,
  getRecordingPathsFromEdfPath,
  buildRecordingPaths,
  MAX_EEG_FILE_BYTES,
} from "@/lib/files";
import * as tus from "tus-js-client";
import {
  NeuroScopeViewer,
  type NeuroScopeViewerHandle,
} from "@/components/neuroscope/neuroscope-viewer";
import {
  useNeuroScopeSession,
  type NeuroScopeBundle,
} from "@/components/neuroscope/neuroscope-session";

async function uploadResumableFile(
  file: File,
  storagePath: string,
  accessToken: string,
) {
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
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError(error) {
        reject(error);
      },
      onSuccess() {
        resolve();
      },
    });
    upload.start();
  });
}

async function waitForNicoletSourceJob(jobId: string) {
  for (let attempt = 0; attempt < 1800; attempt += 1) {
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

async function prepareNicoletSource(file: File) {
  if (!file.name.toLowerCase().endsWith(".e")) {
    throw new Error("Expected a Nicolet .e recording.");
  }
  if (file.size > MAX_EEG_FILE_BYTES) {
    throw new Error("Nicolet .e file is larger than the 5 GB limit.");
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (!user || sessionError || !session?.access_token) {
    throw new Error("Sign in before opening a large Nicolet recording.");
  }
  const paths = buildRecordingPaths(user.id, crypto.randomUUID());
  try {
    await uploadResumableFile(file, paths.source, session.access_token);
    const { data: signedSource, error: signedError } = await supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(paths.source, 3600);
    if (signedError || !signedSource?.signedUrl) {
      throw signedError ?? new Error("Could not open uploaded Nicolet source.");
    }
    const startResponse = await fetch(`${getApiBaseUrl()}/open-saved-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: signedSource.signedUrl,
        filename: file.name,
      }),
    });
    if (!startResponse.ok) {
      throw new Error(
        (await startResponse.text()) || "Could not start Nicolet conversion.",
      );
    }
    const startedJob = await startResponse.json();
    if (!startedJob.job_id) {
      throw new Error("Backend did not return a Nicolet conversion job.");
    }
    const result = await waitForNicoletSourceJob(startedJob.job_id);
    return result;
  } finally {
    const { error } = await supabase.storage
      .from(FILE_BUCKET)
      .remove([paths.source]);
    if (error)
      console.warn("Could not remove temporary Nicolet source:", error.message);
  }
}

function EDFReaderContent() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get("file");
  const router = useRouter();
  const { session: activeSession, setSession } = useNeuroScopeSession();
  const viewerRef = useRef<NeuroScopeViewerHandle>(null);
  const reportRef = useRef<HTMLElement>(null);
  const [savedFile, setSavedFile] = useState<{
    url: string;
    name: string;
    file: File;
    recordingState: unknown | null;
    statePath: string | null;
    reportPath: string | null;
  } | null>(null);
  const [savedFileProgress, setSavedFileProgress] = useState<number | null>(
    null,
  );
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ blob: Blob; name: string } | null>(
    () => activeSession?.report ?? null,
  );
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [reportOutOfDate, setReportOutOfDate] = useState(
    () => (activeSession?.recordingState as any)?.report?.outOfDate ?? false,
  );
  const scrollToReportRef = useRef(false);
  const [savedBundle, setSavedBundle] = useState<NeuroScopeBundle | null>(
    () => activeSession?.bundle ?? null,
  );
  const [viewerHasRecording, setViewerHasRecording] = useState(
    () => !!activeSession,
  );
  const [savingRecording, setSavingRecording] = useState(false);
  const [recordingSaveError, setRecordingSaveError] = useState<string | null>(
    null,
  );
  const [assignedPatient, setAssignedPatient] = useState<PatientSummary | null>(
    () => activeSession?.patient ?? null,
  );
  const latestRecordingStateRef = useRef<unknown | null>(
    activeSession?.recordingState ?? null,
  );
  const latestReportBlobRef = useRef<Blob | null>(
    activeSession?.report?.blob ?? null,
  );
  const activeRecordingFileRef = useRef<File | null>(
    activeSession?.file ?? null,
  );
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    if (!report) {
      setReportUrl(null);
      return;
    }
    const url = URL.createObjectURL(report.blob);
    setReportUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [report]);

  useEffect(() => {
    if (!reportUrl || !scrollToReportRef.current) return;
    scrollToReportRef.current = false;
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reportUrl]);

  useEffect(() => {
    if (!fileId) {
      setSavedFile(null);
      setSavedFileProgress(null);
      setError(null);
      return;
    }

    setReport(null);
    setReportOutOfDate(false);
    setReportStatus(null);
    setSavedBundle(null);
    setSavedFileProgress(0);
    setViewerHasRecording(false);
    setRecordingSaveError(null);
    setAssignedPatient(null);
    latestRecordingStateRef.current = null;
    latestReportBlobRef.current = null;

    let cancelled = false;

    async function prepareSavedFile() {
      try {
        const supabase = createClient();
        const { data: row, error: rowError } = await supabase
          .from("user_files")
          .select("original_name, storage_path, kind, patient_id")
          .eq("id", fileId)
          .eq("kind", "edf")
          .single();

        if (rowError || !row)
          throw rowError ?? new Error("EDF file not found.");
        let linkedPatient: PatientSummary | null = null;
        if (row.patient_id) {
          const { data: patientRow, error: patientError } = await supabase
            .from("patients")
            .select("id, name, patient_identifier, date_of_birth")
            .eq("id", row.patient_id)
            .maybeSingle();
          if (patientError) {
            console.warn(
              "Could not load assigned patient:",
              patientError.message,
            );
          } else if (patientRow) {
            linkedPatient = patientRow as PatientSummary;
          }
        }

        const { data, error: signedError } = await supabase.storage
          .from(FILE_BUCKET)
          .createSignedUrl(row.storage_path, 3600);

        if (signedError || !data?.signedUrl) {
          throw signedError ?? new Error("Could not open the saved EDF file.");
        }
        const fileResponse = await fetch(data.signedUrl);
        if (!fileResponse.ok)
          throw new Error("Could not download the saved EDF file.");
        const contentLength =
          Number(fileResponse.headers.get("content-length")) || 0;
        setSavedFileProgress(contentLength > 0 ? 0 : null);
        let fileBlob: Blob;
        if (fileResponse.body && contentLength > 0) {
          const reader = fileResponse.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.byteLength;
              setSavedFileProgress(
                Math.min(90, Math.round((received / contentLength) * 90)),
              );
            }
          }
          fileBlob = new Blob(chunks, { type: "application/octet-stream" });
        } else {
          fileBlob = await fileResponse.blob();
          setSavedFileProgress(90);
        }
        const savedEdf = new File([fileBlob], row.original_name, {
          type: "application/octet-stream",
        });

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
          } else if (
            stateError &&
            !stateError.message.toLowerCase().includes("not found")
          ) {
            console.warn("Could not load recording state:", stateError.message);
          }
          const { data: reportBlob, error: reportError } =
            await supabase.storage.from(FILE_BUCKET).download(paths.report);
          if (reportBlob) {
            restoredReport = reportBlob;
          } else if (
            reportError &&
            !reportError.message.toLowerCase().includes("not found")
          ) {
            console.warn("Could not load latest report:", reportError.message);
          }
        }
        if (!cancelled) {
          if (paths) {
            setSavedBundle({
              id: fileId!,
              edfPath: paths.edf,
              statePath: paths.state,
              reportPath: paths.report,
            });
          }
          setReportOutOfDate(recordingState?.report?.outOfDate ?? false);
          if (restoredReport) {
            setReport({
              blob: restoredReport,
              name: `${row.original_name.replace(/\.edf$/i, "")}_report.pdf`,
            });
          }
          setAssignedPatient(linkedPatient);
          setSavedFile({
            url: data.signedUrl,
            name: row.original_name,
            file: savedEdf,
            recordingState,
            statePath: paths?.state ?? null,
            reportPath: paths?.report ?? null,
          });
          setSavedFileProgress(100);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not open the saved EDF file.",
          );
        }
      }
    }

    void prepareSavedFile();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const saveRecordingState = useCallback(
    (recordingState: unknown) => {
      const statePath = savedBundle?.statePath ?? savedFile?.statePath;
      if (!statePath) return;
      if (stateSaveTimerRef.current) {
        clearTimeout(stateSaveTimerRef.current);
      }
      stateSaveTimerRef.current = setTimeout(async () => {
        try {
          const blob = new Blob([JSON.stringify(recordingState, null, 2)], {
            type: "application/json",
          });
          const supabase = createClient();
          const { error: uploadError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(statePath, blob, {
              contentType: "application/json",
              upsert: true,
            });
          if (uploadError) throw uploadError;
        } catch (err) {
          console.error("Could not save recording state:", err);
        }
      }, 500);
    },
    [savedBundle?.statePath, savedFile?.statePath],
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
          upsert: true,
        });
      if (error) throw error;
    },
    [savedBundle?.reportPath, savedFile?.reportPath],
  );

  const requestViewerSavePayload = useCallback(() => {
    const payload = viewerRef.current?.getSavePayload();
    if (!payload) throw new Error("Open an EEG recording before saving it.");
    return Promise.resolve(payload);
  }, []);

  const saveViewerRecording = useCallback(
    async (forceNew = false) => {
      if (saveInProgressRef.current) return;
      saveInProgressRef.current = true;
      setRecordingSaveError(null);
      setSavingRecording(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (!user || sessionError || !session?.access_token) {
          throw new Error("You must be signed in to use the EEG Viewer.");
        }
        const payload = await requestViewerSavePayload();
        latestRecordingStateRef.current = payload.state;
        if (payload.file.size > MAX_EEG_FILE_BYTES) {
          throw new Error("EDF file is larger than the 5 GB limit.");
        }
        if (!savedBundle || forceNew) {
          const { data: existingRows, error: duplicateError } = await supabase
            .from("user_files")
            .select("id")
            .eq("user_id", user.id)
            .eq("kind", "edf")
            .eq("original_name", payload.file.name)
            .eq("size_bytes", payload.file.size)
            .limit(1);
          if (duplicateError) throw duplicateError;
          const existing = existingRows?.[0];
          if (existing) {
            router.replace(
              `/edf-reader?file=${encodeURIComponent(existing.id)}`,
            );
            return;
          }
        }
        // Existing recording: explicitly resync its mutable state/report.
        if (savedBundle && !forceNew) {
          const stateBlob = new Blob(
            [
              JSON.stringify(
                latestRecordingStateRef.current ?? payload.state,
                null,
                2,
              ),
            ],
            { type: "application/json" },
          );
          const { error: stateError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(savedBundle.statePath, stateBlob, {
              contentType: "application/json",
              upsert: true,
            });
          if (stateError) throw stateError;
          const reportBlob =
            latestReportBlobRef.current ?? report?.blob ?? null;
          if (reportBlob) {
            const { error: reportError } = await supabase.storage
              .from(FILE_BUCKET)
              .upload(savedBundle.reportPath, reportBlob, {
                contentType: "application/pdf",
                upsert: true,
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
          await uploadResumableFile(
            payload.file,
            paths.edf,
            session.access_token,
          );
          uploadedPaths.push(paths.edf);
          const initialStateBlob = new Blob(
            [JSON.stringify(payload.state, null, 2)],
            { type: "application/json" },
          );
          const { error: stateError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(paths.state, initialStateBlob, {
              contentType: "application/json",
              upsert: false,
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
              size_bytes: payload.file.size,
            })
            .select("id")
            .single();
          if (insertError || !row) {
            throw (
              insertError ?? new Error("Could not create the My Files entry.")
            );
          }
          bundleCreated = true;
          const bundle = {
            id: row.id,
            edfPath: paths.edf,
            statePath: paths.state,
            reportPath: paths.report,
          };
          setSavedBundle(bundle);
          setSession((current) => (current ? { ...current, bundle } : current));
          // Analysis may have changed while the EDF was uploading.
          const latestState = latestRecordingStateRef.current ?? payload.state;
          const latestStateBlob = new Blob(
            [JSON.stringify(latestState, null, 2)],
            { type: "application/json" },
          );
          const { error: latestStateError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(paths.state, latestStateBlob, {
              contentType: "application/json",
              upsert: true,
            });
          if (latestStateError) throw latestStateError;
          // A report may also have been generated during the upload.
          if (latestReportBlobRef.current) {
            const { error: reportError } = await supabase.storage
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
        setRecordingSaveError(
          err instanceof Error ? err.message : "Could not save this recording.",
        );
      } finally {
        saveInProgressRef.current = false;
        setSavingRecording(false);
      }
    },
    [report, requestViewerSavePayload, router, savedBundle],
  );

  const prepareNicolet = useCallback(
    (file: File) => prepareNicoletSource(file),
    [],
  );
  const handleRecordingOpened = useCallback(
    (file: File, initialLoad: boolean) => {
      activeRecordingFileRef.current = file;
      setViewerHasRecording(true);
      setSession((current) => ({
        file,
        recordingState:
          savedFile?.file === file
            ? (savedFile.recordingState ?? current?.recordingState ?? null)
            : current?.file === file
              ? current.recordingState
              : null,
        sourceUrl:
          savedFile?.file === file
            ? savedFile.url
            : current?.file === file
              ? current.sourceUrl
              : null,
        bundle: initialLoad ? (savedBundle ?? current?.bundle ?? null) : null,
        report: initialLoad ? (report ?? current?.report ?? null) : null,
        patient: initialLoad
          ? (assignedPatient ?? current?.patient ?? null)
          : null,
      }));
      if (initialLoad) {
        if (!fileId && !savedBundle) {
          window.setTimeout(() => void saveViewerRecording(true), 0);
        }
        return;
      }
      if (fileId) router.replace("/edf-reader");
      setSavedBundle(null);
      setRecordingSaveError(null);
      setReport(null);
      setReportOutOfDate(false);
      setReportStatus(null);
      scrollToReportRef.current = false;
      latestRecordingStateRef.current = null;
      latestReportBlobRef.current = null;
      window.setTimeout(() => void saveViewerRecording(true), 0);
    },
    [
      fileId,
      router,
      saveViewerRecording,
      savedFile,
      savedBundle,
      report,
      assignedPatient,
      setSession,
    ],
  );
  const handleRecordingStateChange = useCallback(
    (file: File, recordingState: unknown) => {
      if (activeRecordingFileRef.current !== file) return;
      latestRecordingStateRef.current = recordingState;
      setSession((current) =>
        current
          ? { ...current, file, recordingState }
          : {
              file,
              recordingState,
              sourceUrl: null,
              bundle: null,
              report: null,
            },
      );
      setReportOutOfDate((recordingState as any)?.report?.outOfDate ?? false);
      if ((fileId && savedFile?.file === file) || savedBundle) {
        saveRecordingState(recordingState);
      }
    },
    [fileId, savedBundle, savedFile?.file, saveRecordingState, setSession],
  );
  const handleReportGenerated = useCallback(
    (blob: Blob, name: string) => {
      latestReportBlobRef.current = blob;
      scrollToReportRef.current = true;
      setReport({ blob, name });
      setSession((current) =>
        current ? { ...current, report: { blob, name } } : current,
      );
      setReportOutOfDate(false);
      setReportStatus(null);
      if (fileId || savedBundle) {
        void saveLatestReport(blob).catch((err) => {
          console.error("Could not persist latest report:", err);
          setReportStatus(
            err instanceof Error
              ? err.message
              : "Could not save the report with this recording.",
          );
        });
      }
    },
    [fileId, savedBundle, saveLatestReport, setSession],
  );
  const handlePatientAssignmentChange = useCallback(
    (patient: PatientSummary | null) => {
      setAssignedPatient(patient);
      setSession((current) => (current ? { ...current, patient } : current));
    },
    [setSession],
  );
  const initialViewerFile = useMemo(
    () =>
      savedFile
        ? {
            file: savedFile.file,
            recordingState: savedFile.recordingState,
            sourceUrl: savedFile.url,
          }
        : activeSession
          ? {
              file: activeSession.file,
              recordingState: activeSession.recordingState,
              sourceUrl: activeSession.sourceUrl,
            }
          : null,
    [savedFile, activeSession],
  );

  function downloadReport() {
    if (!reportUrl || !report) return;
    const link = document.createElement("a");
    link.href = reportUrl;
    link.download = report.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const assignmentFileId = fileId ?? savedBundle?.id ?? null;

  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-8">
        <div className="section-kicker">Signal review and annotation</div>
        <h1 className="mb-4 text-3xl font-bold tracking-tight">EEG Viewer</h1>
        {viewerHasRecording && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {savingRecording
                ? "Saving to My Files…"
                : fileId || savedBundle
                  ? "Saved in My Files"
                  : "Preparing to save…"}
            </span>
            {assignmentFileId && !savingRecording && (
              <>
                <span className="text-muted-foreground">·</span>
                {assignedPatient ? (
                  <span className="text-muted-foreground">
                    Patient:{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground hover:underline"
                      onClick={() =>
                        router.push(
                          `/patients/${encodeURIComponent(assignedPatient.id)}`,
                        )
                      }
                      title="Open Patient Profile"
                    >
                      {assignedPatient.name?.trim() ||
                        assignedPatient.patient_identifier ||
                        "Unnamed Patient"}
                    </button>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
                <PatientAssignmentDialog
                  fileId={assignmentFileId}
                  currentPatientId={assignedPatient?.id ?? null}
                  onAssignmentChange={handlePatientAssignmentChange}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label={
                        assignedPatient
                          ? "Change Patient Assignment"
                          : "Assign Patient"
                      }
                      title={
                        assignedPatient ? "Change Patient" : "Assign Patient"
                      }
                    >
                      <UserRound className="h-4 w-4" />
                    </Button>
                  }
                />
              </>
            )}
            {recordingSaveError && (
              <Button
                variant="outline"
                onClick={() =>
                  void saveViewerRecording(!fileId && !savedBundle)
                }
              >
                Retry Save
              </Button>
            )}
          </div>
        )}
        {recordingSaveError && (
          <p className="mb-3 text-sm text-destructive">{recordingSaveError}</p>
        )}
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {fileId && !savedFile ? (
          <div
            className="flex h-[calc(100vh-10rem)] min-h-175 flex-col items-center justify-center gap-4 border border-border bg-card px-8 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <span>Opening saved EEG recording…</span>
            <div
              className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Loading EDF file"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={savedFileProgress ?? undefined}
            >
              <div
                className={`h-full bg-primary transition-[width] duration-200 ${savedFileProgress === null ? "w-1/3 animate-pulse" : ""}`}
                style={
                  savedFileProgress === null
                    ? undefined
                    : { width: `${savedFileProgress}%` }
                }
              />
            </div>
            {savedFileProgress !== null && (
              <span className="text-xs tabular-nums">
                {savedFileProgress < 90
                  ? `${savedFileProgress}% downloaded`
                  : "Preparing recording…"}
              </span>
            )}
          </div>
        ) : (
          <div className="neuroscope-host h-[calc(100vh-10rem)] min-h-175 w-full overflow-hidden border border-border bg-white overscroll-contain">
            <NeuroScopeViewer
              ref={viewerRef}
              initialFile={initialViewerFile}
              onRecordingOpened={handleRecordingOpened}
              onRecordingStateChange={handleRecordingStateChange}
              onPrepareNicolet={prepareNicolet}
              onReportGenerated={handleReportGenerated}
            />
          </div>
        )}
        {report && reportUrl && (
          <section ref={reportRef} className="mt-6 scroll-mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="section-kicker">Latest report</div>
                <h2 className="text-xl font-semibold">{report.name}</h2>
              </div>
              <Button variant="outline" onClick={downloadReport}>
                Download PDF
              </Button>
            </div>
            {reportOutOfDate && (
              <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                This report is out of date. Regenerate it to include the latest
                analysis results and annotations.
              </div>
            )}
            {reportStatus && (
              <p className="text-sm text-muted-foreground">{reportStatus}</p>
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
