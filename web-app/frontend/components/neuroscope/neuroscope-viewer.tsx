"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import "./assets/styles.css";
import "./assets/theme.css";
import {
  AnnotationDialog,
  ChannelSidebar,
  UploadScreen,
  ViewerLoadingScreen,
  Waveform,
  formatTime,
} from "@/components/neuroscope/edf-viewer";
import { makeChannels, parseEDF } from "@/lib/neuroscope/edf";
import {
  api,
  createSession,
  createSessionFromUrl,
  getSessionFile,
  watchAnalysisProgress,
  type AnalysisProgress,
} from "@/lib/neuroscope/api";
import type { Annotation, Channel, Recording } from "@/lib/neuroscope/types";
import {
  identifyFile,
  sameFileIdentity,
  type FileIdentity,
} from "@/lib/neuroscope/file-identity";

export type SavedState = {
  annotations?: Annotation[];
  metadata?: unknown;
  seizureDetection?: { status?: string; runAt?: string; results?: unknown };
  backgroundAnalysis?: {
    status?: string;
    runAt?: string;
    summary?: unknown;
    metrics?: unknown;
  };
  report?: { generatedAt?: string; outOfDate?: boolean };
  viewer?: {
    selectedChannelIds?: string[];
    windowSize?: number;
    start?: number;
    gain?: number;
  };
  recording?: {
    fileIdentity?: FileIdentity;
    fileName?: string | null;
    fileSize?: number | null;
    lastModified?: string | null;
  };
};
export type NeuroScopeViewerProps = {
  initialFile?: {
    file: File;
    recordingState: unknown | null;
    sourceUrl?: string | null;
  } | null;
  onRecordingOpened: (file: File, initialLoad: boolean) => void;
  onRecordingStateChange: (file: File, state: unknown) => void;
  onPrepareNicolet: (file: File) => Promise<any>;
  onReportGenerated: (blob: Blob, name: string) => void;
};
export type NeuroScopeViewerHandle = {
  getSavePayload: () => { file: File; state: unknown } | null;
};
const WINDOW_OPTIONS = [5, 10, 20, 30, 60];
type TaskName = "seizure" | "background" | "report";
type ActivityItem = { message: string; status: string; time: string };
function makeAutomatedAnnotations(result: any): Annotation[] {
  const runAt = new Date().toISOString();
  return (result?.seizures || []).flatMap((seizure: any, index: number) => {
    const startSec = seizure.start_time ?? seizure.start_seconds;
    const endSec = seizure.end_time ?? seizure.end_seconds;
    if (startSec == null || endSec == null) return [];
    return [
      {
        id: `automated-seizure-${runAt}-${index}`,
        startSec,
        endSec,
        label: "Seizure",
        notes: "",
        channels: [],
        origin: "automated",
        rejected: false,
        model: {
          meanProbability: seizure.mean_probability ?? null,
          maxProbability: seizure.max_probability ?? null,
          durationSeconds:
            seizure.duration ?? seizure.duration_seconds ?? endSec - startSec,
        },
        createdAt: runAt,
        updatedAt: runAt,
      } satisfies Annotation,
    ];
  });
}
export const NeuroScopeViewer = forwardRef<
  NeuroScopeViewerHandle,
  NeuroScopeViewerProps
>(function NeuroScopeViewer(
  {
    initialFile,
    onRecordingOpened,
    onRecordingStateChange,
    onPrepareNicolet,
    onReportGenerated,
  },
  ref,
) {
  const [file, setFile] = useState<File | null>(null),
    [recording, setRecording] = useState<Recording | null>(null),
    [channels, setChannels] = useState<Channel[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [annotations, setAnnotations] = useState<Annotation[]>([]),
    [windowSize, setWindowSize] = useState(10),
    [start, setStart] = useState(0),
    [gain, setGain] = useState(1),
    [filter, setFilter] = useState(""),
    [range, setRange] = useState<{ startSec: number; endSec: number } | null>(
      null,
    ),
    [annotationDialogOpen, setAnnotationDialogOpen] = useState(false),
    [editing, setEditing] = useState<Annotation | undefined>(),
    [error, setError] = useState(""),
    [isOpening, setIsOpening] = useState(false),
    [loadingFileName, setLoadingFileName] = useState(""),
    [loadingMessage, setLoadingMessage] = useState("Reading EDF file"),
    [runningTasks, setRunningTasks] = useState<Set<TaskName>>(new Set()),
    [taskProgress, setTaskProgress] = useState<
      Partial<Record<TaskName, AnalysisProgress>>
    >({}),
    [playing, setPlaying] = useState(false),
    [activity, setActivity] = useState<ActivityItem[]>([]),
    [analysisExpanded, setAnalysisExpanded] = useState(true),
    [metadata, setMetadata] = useState<unknown>(null),
    [seizureResult, setSeizureResult] = useState<unknown>(null),
    [seizureStatus, setSeizureStatus] = useState<string | null>(null),
    [seizureRunAt, setSeizureRunAt] = useState<string | null>(null),
    [background, setBackground] = useState<unknown>(null),
    [backgroundStatus, setBackgroundStatus] = useState<string | null>(null),
    [backgroundRunAt, setBackgroundRunAt] = useState<string | null>(null),
    [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null),
    [reportOutOfDate, setReportOutOfDate] = useState(false),
    [analysisSessionId, setAnalysisSessionId] = useState<string | null>(null),
    [analysisSourceUrl, setAnalysisSourceUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<File | null>(null),
    recordingRef = useRef<Recording | null>(null),
    fileIdentityRef = useRef<FileIdentity | null>(null),
    initialFileHandled = useRef<File | null>(null);
  const log = useCallback(
    (message: string, status = "info") =>
      setActivity((items) => [
        ...items.slice(-19),
        { message, status, time: new Date().toLocaleTimeString() },
      ]),
    [],
  );
  const opened = useCallback(
    async (
      input: File,
      saved?: SavedState | null,
      sourceUrl?: string | null,
      initialLoad = false,
    ) => {
      setIsOpening(true);
      fileIdentityRef.current = null;
      setLoadingFileName(input.name);
      setLoadingMessage(
        /\.e$/i.test(input.name)
          ? "Preparing Nicolet recording"
          : "Reading EDF file",
      );
      setError("");
      try {
        let actual = input,
          sessionId: string | null = null;
        let uploadResult: any = null;
        if (/\.e$/i.test(input.name)) {
          setLoadingMessage("Converting Nicolet recording to EDF");
          uploadResult = await onPrepareNicolet(input);
          sessionId = uploadResult.session_id;
          setLoadingMessage("Reading converted EDF file");
          actual = await getSessionFile(sessionId!, uploadResult.edf_filename);
        }
        setLoadingMessage("Reading EDF file");
        setLoadingMessage("Verifying EDF file identity");
        const computedIdentity = await identifyFile(actual);
        const savedIdentity = (saved as SavedState | null)?.recording?.fileIdentity;
        const identity =
          savedIdentity &&
          sameFileIdentity(savedIdentity, {
            ...computedIdentity,
            lastModified: savedIdentity.lastModified,
          })
            ? { ...computedIdentity, lastModified: savedIdentity.lastModified }
            : computedIdentity;
        fileIdentityRef.current = identity;
        setLoadingMessage("Reading EDF file");
        const parsed = await parseEDF(actual),
          defs = makeChannels(parsed.signals);
        fileRef.current = actual;
        recordingRef.current = parsed;
        initialFileHandled.current = actual;
        setFile(actual);
        setRecording(parsed);
        setChannels(defs);
        setSelected(
          Array.isArray(saved?.viewer?.selectedChannelIds)
            ? new Set(
                saved.viewer.selectedChannelIds.filter((id) =>
                  defs.some((channel) => channel.id === id),
                ),
              )
            : new Set(
                defs.filter((c) => c.kind === "calculated").map((c) => c.id),
              ),
        );
        const restoredWindow = saved?.viewer?.windowSize;
        const windowValue = WINDOW_OPTIONS.includes(restoredWindow || 0)
          ? restoredWindow!
          : 10;
        setWindowSize(windowValue);
        setStart(
          Math.max(
            0,
            Math.min(parsed.duration - windowValue, saved?.viewer?.start || 0),
          ),
        );
        setGain(saved?.viewer?.gain ?? 1);
        setAnalysisSessionId(sessionId);
        setAnalysisSourceUrl(sourceUrl || null);
        setRunningTasks(new Set());
        setTaskProgress({});
        setActivity([]);
        autoRunKey.current = "";
        autoSeizureSyncRef.current = null;
        setMetadata(
          (saved?.metadata as any) || uploadResult?.recording_metadata || null,
        );
        setAnnotations(saved?.annotations || []);
        setSeizureResult(saved?.seizureDetection?.results || null);
        setSeizureStatus(
          saved?.seizureDetection?.status === "running"
            ? "failed"
            : saved?.seizureDetection?.status || null,
        );
        setSeizureRunAt(saved?.seizureDetection?.runAt || null);
        setBackground(saved?.backgroundAnalysis || null);
        setBackgroundStatus(
          saved?.backgroundAnalysis?.status === "running"
            ? "failed"
            : saved?.backgroundAnalysis?.status || null,
        );
        setBackgroundRunAt(saved?.backgroundAnalysis?.runAt || null);
        setReportGeneratedAt(saved?.report?.generatedAt || null);
        setReportOutOfDate(saved?.report?.outOfDate || false);
        log(`Recording loaded: ${defs.length} channels`);
        onRecordingOpened(actual, initialLoad);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not open EEG recording.";
        setError(message);
      } finally {
        setIsOpening(false);
      }
    },
    [log, onPrepareNicolet, onRecordingOpened],
  );
  const openFile = useCallback(
    (input: File) => {
      void opened(input);
    },
    [opened],
  );
  const recordingState = useCallback(
    () => ({
      schemaVersion: "2.0",
      exportedAt: new Date().toISOString(),
      recording: {
        fileName: fileRef.current?.name || null,
        fileSize: fileIdentityRef.current?.size ?? fileRef.current?.size ?? null,
        lastModified: fileIdentityRef.current
          ? new Date(fileIdentityRef.current.lastModified).toISOString()
          : fileRef.current
            ? new Date(fileRef.current.lastModified).toISOString()
            : null,
        fileIdentity: fileIdentityRef.current,
        durationSec: recordingRef.current?.duration || null,
        startDate: recordingRef.current?.startDate || null,
        startTime: recordingRef.current?.startTime || null,
      },
      metadata,
      annotations,
      seizureDetection: {
        status: seizureStatus,
        runAt: seizureRunAt,
        results: seizureResult,
      },
      backgroundAnalysis: {
        status: backgroundStatus,
        runAt: backgroundRunAt,
        summary: (background as any)?.summary || null,
        metrics: (background as any)?.metrics || null,
      },
      report: { generatedAt: reportGeneratedAt, outOfDate: reportOutOfDate },
      viewer: {
        selectedChannelIds: Array.from(selected),
        windowSize,
        start,
        gain,
      },
    }),
    [
      metadata,
      annotations,
      seizureStatus,
      seizureRunAt,
      seizureResult,
      backgroundStatus,
      backgroundRunAt,
      background,
      reportGeneratedAt,
      reportOutOfDate,
      selected,
      windowSize,
      start,
      gain,
    ],
  );
  useImperativeHandle(
    ref,
    () => ({
      getSavePayload: () => {
        if (!fileRef.current || !recordingRef.current) return null;
        return { file: fileRef.current, state: recordingState() };
      },
    }),
    [recordingState],
  );
  useEffect(() => {
    if (!initialFile || initialFileHandled.current === initialFile.file) return;
    initialFileHandled.current = initialFile.file;
    void opened(
      initialFile.file,
      (initialFile.recordingState as SavedState | null) || null,
      initialFile.sourceUrl || null,
      true,
    );
  }, [initialFile, opened]);
  useEffect(() => {
    if (!file || !recording) return;
    onRecordingStateChange(file, recordingState());
  }, [file, recording, onRecordingStateChange, recordingState]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateTheme = () =>
      root.classList.toggle(
        "dark-mode",
        document.documentElement.classList.contains("dark"),
      );
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  const ensureSession = useCallback(async () => {
    if (analysisSessionId) return analysisSessionId;
    const result = analysisSourceUrl
      ? await createSessionFromUrl(
          analysisSourceUrl,
          file?.name || "recording.edf",
        )
      : await createSession(file!);
    setAnalysisSessionId(result.session_id);
    setMetadata(result.recording_metadata || metadata);
    return result.session_id;
  }, [analysisSessionId, analysisSourceUrl, file, metadata]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleGroup = (ids: string[]) =>
    setSelected((current) => {
      const allSelected = ids.every((id) => current.has(id));
      const next = new Set(current);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  const selectedChannels = useMemo(
    () => channels.filter((c) => selected.has(c.id)),
    [channels, selected],
  );
  const selectedChannelLabels = useMemo(
    () => selectedChannels.map((channel) => channel.label),
    [selectedChannels],
  );
  const markReportOutOfDate = useCallback(() => {
    if (reportGeneratedAt) setReportOutOfDate(true);
  }, [reportGeneratedAt]);
  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((a) =>
      editing
        ? a.map((x) => (x.id === editing.id ? annotation : x))
        : [...a, annotation],
    );
    setEditing(undefined);
    setRange(null);
    setAnnotationDialogOpen(false);
    setReportOutOfDate(true);
  };
  const startTask = (task: TaskName, message: string) => {
    setError("");
    setRunningTasks((current) => new Set(current).add(task));
    setTaskProgress((current) => ({
      ...current,
      [task]: { percent: null, message, events: [] },
    }));
    log(message);
  };
  const finishTask = (task: TaskName, message: string, status: string) => {
    setRunningTasks((current) => {
      const next = new Set(current);
      next.delete(task);
      return next;
    });
    setTaskProgress((current) => ({
      ...current,
      [task]: {
        ...current[task],
        percent:
          status === "completed" ? 100 : (current[task]?.percent ?? null),
        message,
      },
    }));
    log(message, status);
  };
  const trackTask = (sessionId: string, task: TaskName) =>
    watchAnalysisProgress(sessionId, task, (progress) => {
      setTaskProgress((current) => ({ ...current, [task]: progress }));
      progress.events.forEach((event) => {
        log(
          event.message,
          event.status === "failed"
            ? "error"
            : event.status === "completed"
              ? "success"
              : "info",
        );
      });
    });
  const runSeizure = async () => {
    if (!file || runningTasks.has("seizure")) return;
    markReportOutOfDate();
    setSeizureStatus("running");
    setSeizureRunAt(new Date().toISOString());
    startTask("seizure", "Preparing seizure detection");
    let stopProgress: (() => void) | undefined;
    try {
      const id = await ensureSession();
      stopProgress = trackTask(id, "seizure");
      log("Running seizure detection model");
      const r = await api(`/seizure-detection/${id}`, { method: "POST" }).then(
        (x) => x.json(),
      );
      if (r.status !== "completed")
        throw Error(r.detail || "Seizure detection failed.");
      setSeizureResult(r.seizure_detection);
      setSeizureStatus("completed");
      setAnnotations((current) =>
        [
          ...current.filter((annotation) => annotation.origin !== "automated"),
          ...makeAutomatedAnnotations(r.seizure_detection),
        ].sort((a, b) => a.startSec - b.startSec),
      );
      finishTask("seizure", "Seizure detection complete", "completed");
    } catch (e) {
      setSeizureStatus("failed");
      const message =
        e instanceof Error ? e.message : "Seizure detection failed";
      setError(message);
      setAnnotations((current) =>
        current.filter((a) => a.origin !== "automated"),
      );
      finishTask("seizure", message, "error");
    } finally {
      stopProgress?.();
    }
  };
  const runBackground = async () => {
    if (!file || runningTasks.has("background")) return;
    markReportOutOfDate();
    setBackgroundStatus("running");
    setBackgroundRunAt(new Date().toISOString());
    startTask("background", "Preparing background analysis");
    let stopProgress: (() => void) | undefined;
    try {
      const id = await ensureSession();
      stopProgress = trackTask(id, "background");
      log("Calculating EEG background features and signal quality");
      const r = await api(`/background-analysis/${id}`, {
        method: "POST",
      }).then((x) => x.json());
      if (r.status !== "completed")
        throw Error(r.detail || "Background analysis failed.");
      setBackground(r.background_analysis);
      setMetadata(r.recording_metadata || metadata);
      setBackgroundStatus("completed");
      finishTask("background", "Background analysis complete", "completed");
    } catch (e) {
      setBackgroundStatus("failed");
      const message =
        e instanceof Error ? e.message : "Background analysis failed";
      setError(message);
      finishTask("background", message, "error");
    } finally {
      stopProgress?.();
    }
  };
  const autoRunKey = useRef("");
  const autoSeizureSyncRef = useRef<unknown>(null);
  useEffect(() => {
    if (
      seizureStatus !== "completed" ||
      !seizureResult ||
      !((seizureResult as any)?.seizures || []).length ||
      autoSeizureSyncRef.current === seizureResult
    )
      return;
    autoSeizureSyncRef.current = seizureResult;
    setAnnotations((current) => [
      ...current.filter((annotation) => annotation.origin !== "automated"),
      ...makeAutomatedAnnotations(seizureResult),
    ]);
  }, [seizureStatus, seizureResult, annotations]);
  useEffect(() => {
    if (!file || !recording || (!!seizureStatus && !!backgroundStatus)) return;
    const needSeizure = !seizureStatus,
      needBackground = !backgroundStatus;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (autoRunKey.current === key) return;
    autoRunKey.current = key;
    void (async () => {
      if (needSeizure) await runSeizure();
      if (needBackground) await runBackground();
    })();
  }, [file, recording, seizureStatus, backgroundStatus]);
  const generateReport = async () => {
    if (!file || !recording || runningTasks.has("report")) return;
    startTask("report", "Preparing report generation");
    let stopProgress: (() => void) | undefined;
    try {
      const id = await ensureSession();
      stopProgress = trackTask(id, "report");
      log("Sending findings and annotations to the report builder");
      const body = new FormData();
      body.append("session_id", id);
      const activeCandidates = annotations.filter(
        (annotation) =>
          annotation.origin === "automated" && !annotation.rejected,
      );
      const reportSeizures = seizureResult
        ? {
            ...(seizureResult as Record<string, unknown>),
            seizure_count: activeCandidates.length,
            seizures: activeCandidates.map((annotation) => ({
              start_time: annotation.startSec,
              end_time: annotation.endSec,
              duration:
                annotation.model?.durationSeconds ??
                annotation.endSec - annotation.startSec,
              mean_probability: annotation.model?.meanProbability ?? null,
              max_probability: annotation.model?.maxProbability ?? null,
            })),
          }
        : {};
      body.append("seizure_results_json", JSON.stringify(reportSeizures));
      body.append(
        "annotation_results_json",
        JSON.stringify({
          schemaVersion: "1.0",
          recording: {
            fileName: file.name,
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
            durationSec: recording.duration,
            startDate: recording.startDate,
            startTime: recording.startTime,
          },
          annotations: annotations.filter((a) => a.origin !== "automated"),
        }),
      );
      body.append("seizure_detection_status", seizureStatus || "");
      body.append("recording_metadata_json", JSON.stringify(metadata || {}));
      const blob = await (
          await api("/report", { method: "POST", body })
        ).blob(),
        name = `${file.name.replace(/\.edf$/i, "")}_report.pdf`;
      onReportGenerated(blob, name);
      setReportGeneratedAt(new Date().toISOString());
      setReportOutOfDate(false);
      finishTask("report", "Report PDF generated", "completed");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not generate report";
      setError(message);
      finishTask("report", message, "error");
    } finally {
      stopProgress?.();
    }
  };
  const exportState = () => {
    if (!file) return;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(recordingState(), null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.edf$/i, "")}.recording-state.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importState = async (f?: File) => {
    if (!f || !file) return;
    try {
      const v = JSON.parse(await f.text()) as SavedState & {
        seizureDetection?:
          SavedState["seizureDetection"] | Record<string, unknown>;
      };
      if (!Array.isArray(v.annotations))
        throw Error("Recording state does not contain valid annotations.");
      if (!fileIdentityRef.current)
        throw Error("Could not verify the currently open EEG file.");
      if (!v.recording?.fileIdentity)
        throw Error(
          "This recording state predates file identity verification. Export it again from the original recording before importing it.",
        );
      if (!sameFileIdentity(v.recording.fileIdentity, fileIdentityRef.current))
        throw Error("This recording state belongs to a different EEG file.");
      setAnnotations(v.annotations);
      setMetadata(v.metadata || null);
      const legacyDetection = v.seizureDetection as
        Record<string, unknown> | undefined;
      const hasWrappedResult =
        !!legacyDetection && Object.hasOwn(legacyDetection, "results");
      setSeizureResult(
        hasWrappedResult
          ? (legacyDetection?.results as unknown) || null
          : (legacyDetection as unknown) || null,
      );
      setSeizureStatus(
        (legacyDetection?.status as string) ||
          (legacyDetection && !hasWrappedResult ? "completed" : null),
      );
      setSeizureRunAt((legacyDetection?.runAt as string) || null);
      setBackground(v.backgroundAnalysis || null);
      setBackgroundStatus(v.backgroundAnalysis?.status || null);
      setBackgroundRunAt(v.backgroundAnalysis?.runAt || null);
      setReportGeneratedAt(v.report?.generatedAt || null);
      setReportOutOfDate(v.report?.outOfDate || false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid recording state");
    }
  };
  const seek = (value: number) =>
    setStart(
      Math.max(
        0,
        Math.min(recording ? recording.duration - windowSize : 0, value),
      ),
    );
  const zoom = (direction: number) =>
    setWindowSize((current) => {
      const index = WINDOW_OPTIONS.indexOf(current);
      return WINDOW_OPTIONS[
        Math.max(0, Math.min(WINDOW_OPTIONS.length - 1, index + direction))
      ];
    });
  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (annotationDialogOpen) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
      )
        return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(start - windowSize * 0.25);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(start + windowSize * 0.25);
      } else if (event.key.toLowerCase() === "a" && range) {
        setEditing(undefined);
        setAnnotationDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recording, annotationDialogOpen, range, start, windowSize]);
  useEffect(() => {
    if (!playing || !recording) return;
    const timer = setInterval(() => {
      const end = Math.max(0, recording.duration - windowSize);
      const next = start + windowSize * 0.2;
      if (next >= end) {
        setStart(end);
        setPlaying(false);
      } else setStart(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, windowSize, recording, start]);
  if (isOpening)
    return (
      <div className="neuroscope-root" ref={rootRef}>
        <ViewerLoadingScreen
          fileName={loadingFileName || file?.name || "Opening recording"}
          message={loadingMessage}
        />
      </div>
    );
  if (!file || !recording)
    return (
      <div className="neuroscope-root" ref={rootRef}>
        {error && (
          <div role="alert" className="toast show">
            {error}
          </div>
        )}
        <UploadScreen onFile={openFile} />
      </div>
    );
  return (
    <div className="neuroscope-root" ref={rootRef}>
      <section className="workspace">
        <ChannelSidebar
          channels={channels}
          selected={selected}
          onToggle={toggle}
          onToggleGroup={toggleGroup}
          onToggleAll={() =>
            setSelected(
              selected.size ? new Set() : new Set(channels.map((c) => c.id)),
            )
          }
          recording={recording}
          filter={filter}
          onFilter={setFilter}
        />
        <section className="viewer-panel">
          <div className="toolbar">
            <div className="transport">
              <button
                className="icon-button"
                onClick={() => seek(start - windowSize * 0.8)}
              >
                ←
              </button>
              <button
                className="icon-button"
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                className="icon-button"
                onClick={() => seek(start + windowSize * 0.8)}
              >
                →
              </button>
            </div>
            <div className="time-readout">
              <strong>{formatTime(start, true)}</strong>
              <span> / {formatTime(recording.duration)}</span>
            </div>
            <div className="toolbar-spacer" />
            <label className="control">
              Window{" "}
              <select
                value={windowSize}
                onChange={(e) => setWindowSize(Number(e.target.value))}
              >
                {WINDOW_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n < 60 ? `${n} sec` : "1 min"}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              Gain{" "}
              <select
                value={gain}
                onChange={(e) => setGain(Number(e.target.value))}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <button className="button compact" onClick={() => setGain(1)}>
              Fit signals
            </button>
            <button
              className="button compact"
              onClick={() => document.getElementById("open-file")?.click()}
            >
              Open recording
            </button>
            <input
              id="open-file"
              hidden
              type="file"
              accept=".edf,.e"
              onChange={(e) => {
                const nextFile = e.target.files?.[0];
                e.target.value = "";
                if (nextFile) openFile(nextFile);
              }}
            />
          </div>
          <Waveform
            file={file}
            recording={recording}
            selected={selectedChannels}
            start={start}
            duration={windowSize}
            gain={gain}
            annotations={annotations}
            onZoom={zoom}
            selection={range}
            onSeek={seek}
            onSelect={(a, b) =>
              setRange({ startSec: Math.min(a, b), endSec: Math.max(a, b) })
            }
          />
          <div className="timeline">
            <span>{formatTime(start)}</span>
            <input
              type="range"
              min="0"
              max="1000"
              value={
                recording.duration <= windowSize
                  ? 0
                  : Math.round(
                      (start / (recording.duration - windowSize)) * 1000,
                    )
              }
              onChange={(e) =>
                seek(
                  (Number(e.target.value) / 1000) *
                    (recording.duration - windowSize),
                )
              }
            />
            <span>{formatTime(recording.duration)}</span>
          </div>
        </section>
        <aside className="annotations-panel">
          <div className="side-heading">
            <div>
              <span className="eyebrow">Review</span>
              <h2>Annotations</h2>
            </div>
            <span className="count">
              {
                annotations.filter(
                  (a) => !(a.origin === "automated" && a.rejected),
                ).length
              }
            </span>
          </div>
          <button
            className="button primary full"
            disabled={!range}
            onClick={() => setAnnotationDialogOpen(true)}
          >
            + Add annotation
          </button>
          <div className="annotation-file-actions">
            <label className="button ghost">
              Import JSON
              <input
                hidden
                type="file"
                accept=".json"
                onChange={(e) => {
                  void importState(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button className="button ghost" onClick={exportState}>
              Export JSON
            </button>
            <button
              id="generateReport"
              className="button primary"
              disabled={
                runningTasks.has("report") || backgroundStatus !== "completed"
              }
              onClick={() => void generateReport()}
            >
              {reportGeneratedAt && reportOutOfDate
                ? "Regenerate Report"
                : runningTasks.has("report")
                  ? "Generating Report…"
                  : "Generate Report"}
            </button>
          </div>
          <div className="annotation-list">
            {annotations.some(
              (annotation) =>
                !(annotation.origin === "automated" && annotation.rejected),
            ) ? (
              annotations
                .filter(
                  (annotation) =>
                    !(annotation.origin === "automated" && annotation.rejected),
                )
                .map((a) => (
                  <article
                    className={`annotation annotation-${a.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                    key={a.id}
                    title={a.notes || undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() => seek(a.startSec)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        seek(a.startSec);
                      }
                    }}
                  >
                    <div className="annotation-card-header">
                      <strong>
                        {a.label}
                        {a.origin === "automated" ? " · model" : ""}
                      </strong>
                      <span className="annotation-time">
                        {formatTime(a.startSec, true)} –{" "}
                        {formatTime(a.endSec, true)}
                      </span>
                    </div>
                    <div className="annotation-actions">
                      <button
                        className="annotation-edit"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditing(a);
                          setRange(a);
                          setAnnotationDialogOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="annotation-delete"
                        aria-label={`Delete ${a.label} annotation`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setAnnotations((items) =>
                            a.origin === "automated"
                              ? items.map((item) =>
                                  item.id === a.id
                                    ? {
                                        ...item,
                                        rejected: true,
                                        updatedAt: new Date().toISOString(),
                                      }
                                    : item,
                                )
                              : items.filter((item) => item.id !== a.id),
                          );
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))
            ) : (
              <div className="aside-empty">
                Select a region of the waveform to add a clinical annotation.
              </div>
            )}
          </div>
          <div className="analysis-actions">
            <button
              className="button ghost"
              disabled={runningTasks.has("seizure")}
              onClick={() => void runSeizure()}
            >
              {seizureStatus === "completed"
                ? "Re-run seizure detection"
                : seizureStatus === "failed"
                  ? "Retry seizure detection"
                  : "Run seizure detection"}
            </button>
            <button
              className="button ghost"
              disabled={runningTasks.has("background")}
              onClick={() => void runBackground()}
            >
              {backgroundStatus === "completed"
                ? "Re-run background analysis"
                : backgroundStatus === "failed"
                  ? "Retry background analysis"
                  : "Run background analysis"}
            </button>
          </div>
          <section className="analysis-console">
            <div className="analysis-console-heading">
              <button
                type="button"
                aria-expanded={analysisExpanded}
                onClick={() => setAnalysisExpanded((expanded) => !expanded)}
              >
                <strong>Analysis activity</strong>
                <span className="analysis-console-chevron" aria-hidden="true">
                  {analysisExpanded ? "▴" : "▾"}
                </span>
              </button>
              <span>{runningTasks.size ? "IN PROGRESS" : "ACTIVITY LOG"}</span>
            </div>
            {analysisExpanded && (
              <div className="analysis-console-body">
                {(["seizure", "background", "report"] as const).map((task) => {
                  const progress = taskProgress[task];
                  const active = runningTasks.has(task);
                  if (!progress && !active) return null;
                  return (
                    <div className="analysis-task-progress" key={task}>
                      <div className="analysis-progress-label">
                        <span>
                          {task === "seizure"
                            ? "Seizure detection"
                            : task === "background"
                              ? "Background analysis"
                              : "Report generation"}
                        </span>
                        <span>
                          {active
                            ? progress?.percent == null
                              ? "Working…"
                              : `${Math.round(progress.percent)}%`
                            : progress?.message}
                        </span>
                      </div>
                      <div
                        className={`analysis-progress ${active && progress?.percent == null ? "indeterminate" : ""}`}
                      >
                        <i
                          style={{
                            width: `${active && progress?.percent == null ? 35 : (progress?.percent ?? 0)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                <ol className="analysis-console-log">
                  {activity.map((item, i) => (
                    <li className={item.status} key={`${item.time}-${i}`}>
                      <time>{item.time}</time>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
          {error && <p role="alert">{error}</p>}
        </aside>
      </section>
      <AnnotationDialog
        range={annotationDialogOpen ? range : null}
        existing={editing}
        defaultChannels={selectedChannelLabels}
        onClose={() => {
          setAnnotationDialogOpen(false);
          setRange(null);
          setEditing(undefined);
        }}
        onSave={addAnnotation}
      />
    </div>
  );
});
