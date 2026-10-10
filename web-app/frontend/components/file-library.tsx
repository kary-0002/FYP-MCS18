"use client";

import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Activity, ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  buildRecordingPaths,
  buildStoragePath,
  getRecordingPathsFromEdfPath,
  classifyFile,
  isNicoletSourceFile,
  FILE_BUCKET,
  MAX_FILE_BYTES,
  MAX_EEG_FILE_BYTES,
  type FileKind,
} from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UserFileRow {
  id: string;
  kind: FileKind;
  original_name: string;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
}

type FileFilter = "all" | FileKind;
type SortKey = "name" | "kind" | "size" | "date";

function SortHeader({
  label,
  sort,
  active,
  direction,
  onSort,
}: {
  label: string;
  sort: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sort)}
      className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
      aria-label={`Sort by ${label}${active ? `, ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}<Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function formatFileSize(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatAddedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getApiBaseUrl() {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    return "http://127.0.0.1:8000";
  }
  return "https://fyp-api.azutoro.com";
}

export function FileLibrary() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<UserFileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [draggingFile, setDraggingFile] = useState(false);
  const [renameTarget, setRenameTarget] = useState<UserFileRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const uploadFileRef = useRef<(file: File) => void>(() => {});

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return files
      .filter((file) => typeFilter === "all" || file.kind === typeFilter)
      .filter((file) => !normalizedQuery || file.original_name.toLocaleLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        let comparison = 0;
        if (sortKey === "name") comparison = a.original_name.localeCompare(b.original_name, undefined, { sensitivity: "base", numeric: true });
        if (sortKey === "kind") comparison = a.kind.localeCompare(b.kind);
        if (sortKey === "size") comparison = (a.size_bytes ?? -1) - (b.size_bytes ?? -1);
        if (sortKey === "date") comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [files, query, sortDirection, sortKey, typeFilter]);

  const totalBytes = files.reduce((total, file) => total + (file.size_bytes ?? 0), 0);

  function changeSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "name" || key === "kind" ? "asc" : "desc");
    }
  }

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("user_files")
      .select("id, kind, original_name, storage_path, size_bytes, created_at")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      setFiles((data ?? []) as UserFileRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    let dragDepth = 0;
    const hasDraggedFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setDraggingFile(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDraggingFile(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      setDraggingFile(false);
      const file = event.dataTransfer?.files[0];
      if (file) uploadFileRef.current(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function findExistingEeg(userId: string, fileName: string, fileSize: number) {
    const { data, error: duplicateError } = await supabase
      .from("user_files")
      .select("id, storage_path")
      .eq("user_id", userId)
      .eq("kind", "edf")
      .eq("original_name", fileName)
      .eq("size_bytes", fileSize)
      .limit(1);
    if (duplicateError) throw duplicateError;
    return data?.[0] ?? null;
  }

  async function uploadResumable(file: File, storagePath: string, accessToken: string, progressLabel: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${accessToken}`},
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
        onProgress(bytesUploaded, bytesTotal) {
          const percentage = bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;
          setStatus(`${progressLabel} ${percentage}%`);
        },
        onSuccess() {
          resolve();
        }
      });
      upload.start();
    });
  }

  async function waitForNicoletSourceJob(jobId: string) {
    const maxAttempts = 1800;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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

  async function uploadNicoletRecording(file: File, userId: string, accessToken: string) {
    const paths = buildRecordingPaths(userId, crypto.randomUUID());
    try {
      // 1. Upload the original .e directly to Supabase.
      await uploadResumable(file, paths.source, accessToken, "Uploading Nicolet source...");
      setStatus("Preparing Nicolet recording...");

      // 2. Give FastAPI temporary access to the uploaded .e file.
      const { data: signedSource, error: signedError } = await supabase.storage
        .from(FILE_BUCKET)
        .createSignedUrl(paths.source, 3600);
      if (signedError || !signedSource?.signedUrl) {
        throw signedError ?? new Error("Could not open uploaded Nicolet source.");
      }

      // 3. FastAPI downloads the .e from Supabase and converts it to EDF.
      const conversionResponse = await fetch(
        `${getApiBaseUrl()}/open-saved-source`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: signedSource.signedUrl, filename: file.name })
        }
      );
      if (!conversionResponse.ok) {
        throw new Error((await conversionResponse.text()) || "Could not start Nicolet conversion.");
      }
      const conversionJob = await conversionResponse.json();
      if (!conversionJob.job_id) {
        throw new Error("Backend did not return a Nicolet conversion job.");
      }
      setStatus("Converting Nicolet recording...");
      const conversionResult = await waitForNicoletSourceJob(conversionJob.job_id);
      setStatus("Saving converted EDF...");

      // 4. Download the converted EDF from the backend.
      const edfResponse = await fetch(`${getApiBaseUrl()}/edf/${conversionResult.session_id}`);
      if (!edfResponse.ok) {
        throw new Error("Could not download the converted EDF.");
      }
      const edfBlob = await edfResponse.blob();
      const edfName = `${file.name.replace(/\.e$/i, "")}.edf`;
      const edfFile = new File(
        [edfBlob],
        edfName,
        { type: "application/octet-stream", lastModified: Date.now() }
      );
      const existing = await findExistingEeg(userId, edfName, edfFile.size);
      if (existing) {
        await supabase.storage
          .from(FILE_BUCKET)
          .remove([paths.source]);
        setStatus(`${edfName} is already in My Files.`);
        return;
      }

      // 5. Store the converted EDF permanently using resumable upload too.
      await uploadResumable(edfFile, paths.edf, accessToken, "Saving converted EDF...");

      // 6. Create the initial persisted recording state.
      const now = new Date().toISOString();
      const initialRecordingState = {
        schemaVersion: "2.0",
        exportedAt: now,
        recording: {
          fileName: edfName,
          fileSize: edfFile.size,
          lastModified: now,
          durationSec: null,
          startDate: null,
          startTime: null,
        },
        metadata: conversionResult.recording_metadata ?? null,
        annotations: [],
        seizureDetection: {
          status: null,
          runAt: null,
          results: null,
        },
        backgroundAnalysis: {
          status: null,
          runAt: null,
          summary: null,
          metrics: null,
        },
        report: {
          generatedAt: null,
          outOfDate: false,
        }
      };
      const stateBlob = new Blob(
        [JSON.stringify(initialRecordingState, null, 2)],
        { type: "application/json" }
      );
      const { error: stateError } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(paths.state, stateBlob, { contentType: "application/json", upsert: false });
      if (stateError) throw stateError;

      // 7. Only the converted EDF becomes a permanent My Files entry.
      const { error: insertError } = await supabase.from("user_files")
        .insert({
          user_id: userId,
          kind: "edf",
          original_name: edfName,
          storage_path: paths.edf,
          size_bytes: edfFile.size
        });

      if (insertError) throw insertError;

      // 8. Original .e is temporary; remove it after successful conversion.
      const { error: cleanupError } = await supabase.storage.from(FILE_BUCKET).remove([paths.source]);
      if (cleanupError) {
        console.warn(
          "Could not remove temporary Nicolet source:",
          cleanupError.message
        );
      }
      setStatus(`Saved ${edfName.replace(/\.edf$/i, "")}`);
    } catch (err) {
      // Avoid leaving a temporary .e behind after a failed conversion.
      await supabase.storage.from(FILE_BUCKET).remove([paths.source]).catch(() => {});
      throw err;
    }
  }

  async function uploadFile(file: File) {
    setError(null);
    setStatus(null);
    const isNicolet = isNicoletSourceFile(file);
    const kind = classifyFile(file);
    if (!isNicolet && !kind) {
      setError("Supported files: EDF (.edf), Nicolet (.e), and PDF (.pdf).");
      return;
    }
    if (isNicolet && file.size > MAX_EEG_FILE_BYTES) {
      setError("Nicolet .e file is larger than the 5 GB limit.");
      return;
    }
    if (kind === "edf" && file.size > MAX_EEG_FILE_BYTES) {
      setError("EDF file is larger than the 5 GB limit.");
      return;
    }
    if (kind === "pdf" && file.size > MAX_FILE_BYTES) {
      setError("PDF file is larger than the 500 MB limit.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Please sign in before uploading.");
      return;
    }

    setUploading(true);
    try {
      if (kind === "edf") {
        const existing = await findExistingEeg(user.id, file.name, file.size);
        if (existing) {
          setStatus(`${file.name} is already in My Files.`);
          return;
        }
      }
      if (isNicolet) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw sessionError ?? new Error("Your login session could not be retrieved.");
        }
        await uploadNicoletRecording(file, user.id, session.access_token);
        await loadFiles();
        return;
      }
      if (!kind) throw new Error("Unsupported file type.");

      const storagePath =
        kind === "edf"
          ? buildRecordingPaths(user.id, crypto.randomUUID()).edf
          : buildStoragePath(user.id, kind, file.name);

      if (kind === "edf") {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw sessionError ?? new Error("Your login session could not be retrieved.");
        }
        await uploadResumable(file, storagePath, session.access_token, "Uploading EDF...");
      } else {
        const { error: uploadError } = await supabase.storage
          .from(FILE_BUCKET)
          .upload(storagePath, file, {
            contentType: "application/pdf",
            upsert: false
          });
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from("user_files").insert({
        user_id: user.id,
        kind,
        original_name: file.name,
        storage_path: storagePath,
        size_bytes: file.size,
      });

      if (insertError) throw insertError;

      setStatus(`Saved ${file.name}`);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(row: UserFileRow) {
    if (row.kind === "edf") {
      router.push(`/edf-reader?file=${encodeURIComponent(row.id)}`);
      return;
    }

    const { data, error: signedError } = await supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(row.storage_path, 60);

    if (signedError || !data?.signedUrl) {
      setError(signedError?.message ?? "Could not create a download link.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  uploadFileRef.current = uploadFile;

  async function handleDelete(row: UserFileRow) {
    const confirmed = window.confirm(
      row.kind === "edf"
        ? `Delete "${row.original_name}"?\n\nThis will permanently delete the EEG recording, its saved analysis state, annotations, and generated report.`
        : `Delete "${row.original_name}"?\n\nThis will permanently delete this report.`
    );
    if (!confirmed) return;
    setError(null);
    const recordingPaths = row.kind === "edf" ? getRecordingPathsFromEdfPath(row.storage_path) : null;
    const storagePaths = recordingPaths
      ? [recordingPaths.edf, recordingPaths.state, recordingPaths.report, recordingPaths.source]
      : [row.storage_path];

    const { error: storageError } = await supabase.storage
      .from(FILE_BUCKET)
      .remove(storagePaths);

    if (storageError) {
      setError(storageError.message);
      return;
    }

    const { error: deleteError } = await supabase
      .from("user_files")
      .delete()
      .eq("id", row.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setFiles((current) => current.filter((file) => file.id !== row.id));
  }

  function openRename(row: UserFileRow) {
    const extension = row.original_name.match(/\.[^.]+$/)?.[0] ?? "";
    setRenameTarget(row);
    setRenameValue(extension ? row.original_name.slice(0, -extension.length) : row.original_name);
    setRenameError(null);
    setError(null);
    setStatus(null);
  }

  async function submitRename(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;
    const baseName = renameValue.trim();
    if (!baseName || baseName === "." || baseName === "..") {
      setRenameError("Enter a valid file name.");
      return;
    }
    if (/[\\/\u0000]/.test(baseName)) {
      setRenameError("File names can’t contain slashes.");
      return;
    }
    const extension = renameTarget.original_name.match(/\.[^.]+$/)?.[0] ?? "";
    const newName = `${baseName}${extension}`;
    if (newName.length > 255) {
      setRenameError("File names must be 255 characters or fewer.");
      return;
    }
    if (newName === renameTarget.original_name) {
      setRenameTarget(null);
      return;
    }

    setRenaming(true);
    setRenameError(null);
    try {
      const { error: renameError } = await supabase
        .from("user_files")
        .update({ original_name: newName })
        .eq("id", renameTarget.id)
        .select("id")
        .single();
      if (renameError) throw renameError;

      setFiles((current) => current.map((file) =>
        file.id === renameTarget.id ? { ...file, original_name: newName } : file
      ));
      setStatus(`Renamed to ${newName}`);
      setRenameTarget(null);
    } catch (err) {
      const errorRecord = typeof err === "object" && err !== null
        ? err as { message?: unknown; code?: unknown }
        : null;
      const message = typeof errorRecord?.message === "string"
        ? errorRecord.message
        : err instanceof Error ? err.message : "Could not rename the file.";
      if (errorRecord?.code === "42501" || /row-level security/i.test(message)) {
        setRenameError(`${message} Check that Supabase has an UPDATE policy on public.user_files scoped to auth.uid() = user_id.`);
      } else if (errorRecord?.code === "PGRST116") {
        setRenameError("Supabase did not return the updated row. Check the table’s UPDATE policy and confirm this file belongs to the signed-in user.");
      } else {
        setRenameError(message);
      }
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-sm" aria-label="Library highlights">
          <span><strong className="font-semibold text-foreground">{loading ? "—" : files.length}</strong> files</span>
          <span><strong className="font-semibold text-foreground">{loading ? "—" : files.filter((file) => file.kind === "edf").length}</strong> EEG recordings</span>
          <span><strong className="font-semibold text-foreground">{loading ? "—" : formatFileSize(totalBytes)}</strong> used</span>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          <Button type="button" onClick={() => document.getElementById("document-upload")?.click()} disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />{uploading ? "Uploading…" : "Upload file"}
          </Button>
        </div>
        <input
          id="document-upload"
          type="file"
          accept=".edf,.e,.pdf,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {draggingFile && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center bg-background/75 p-6 backdrop-blur-sm">
          <div className="flex min-h-64 w-full max-w-xl flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-card px-8 py-12 text-center shadow-2xl">
            <div className="rounded-full bg-primary/10 p-4 text-primary"><Upload className="h-8 w-8" /></div>
            <h2 className="mt-5 text-xl font-semibold">Drop to upload</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">EDF and Nicolet .e files up to 5 GB, PDF files up to 500 MB.</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <Card className="overflow-hidden">
        <div className="space-y-4 border-b p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold">Browse files</h2>
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading your library…" : `${visibleFiles.length} of ${files.length} ${files.length === 1 ? "file" : "files"}`}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadFiles()} disabled={loading} aria-label="Refresh file list">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by file name…"
                aria-label="Search files by name"
                className="pl-9"
              />
            </label>
            <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Filter by file type">
              {([
                ["all", "All files", files.length],
                ["edf", "EEG", files.filter((file) => file.kind === "edf").length],
                ["pdf", "Reports", files.filter((file) => file.kind === "pdf").length],
              ] as const).map(([filter, label, count]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTypeFilter(filter)}
                  aria-pressed={typeFilter === filter}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${typeFilter === filter ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}<span className="ml-1.5 text-xs text-muted-foreground">{count}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Accepted: EDF (.edf) and Nicolet (.e) up to 5 GB, PDF (.pdf) up to 500 MB.</p>
        </div>

        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading files">
            {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : files.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <FileText className="mx-auto h-9 w-9 text-muted-foreground/60" />
            <h3 className="mt-3 font-medium">Your library is empty</h3>
            <p className="mt-1 text-sm text-muted-foreground">Upload an EEG recording to start building your library.</p>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <h3 className="mt-3 font-medium">No files match those filters</h3>
            <p className="mt-1 text-sm text-muted-foreground">Try another name or file type.</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => { setQuery(""); setTypeFilter("all"); }}>Clear search and filters</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide">
                <tr>
                  <th scope="col" aria-sort={sortKey === "name" ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="px-5 py-3"><SortHeader label="Name" sort="name" active={sortKey === "name"} direction={sortDirection} onSort={changeSort} /></th>
                  <th scope="col" aria-sort={sortKey === "kind" ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="px-4 py-3"><SortHeader label="File type" sort="kind" active={sortKey === "kind"} direction={sortDirection} onSort={changeSort} /></th>
                  <th scope="col" aria-sort={sortKey === "size" ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="px-4 py-3 text-right"><SortHeader label="Size" sort="size" active={sortKey === "size"} direction={sortDirection} onSort={changeSort} /></th>
                  <th scope="col" aria-sort={sortKey === "date" ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className="px-4 py-3"><SortHeader label="Date added" sort="date" active={sortKey === "date"} direction={sortDirection} onSort={changeSort} /></th>
                  <th scope="col" className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleFiles.map((file) => (
                  <tr key={file.id} className="group transition-colors hover:bg-muted/30">
                    <td className="max-w-[360px] px-5 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-md bg-primary/10 p-2 text-primary">
                          {file.kind === "edf" ? <Activity className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </div>
                        <span className="truncate font-medium" title={file.original_name}>{file.original_name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${file.kind === "edf" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"}`}>
                        {file.kind === "edf" ? "EEG recording · EDF" : "Report · PDF"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-muted-foreground">{formatFileSize(file.size_bytes)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground" title={new Date(file.created_at).toLocaleString()}>{formatAddedDate(file.created_at)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => void handleDownload(file)}>Open</Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => openRename(file)}
                          aria-label={`Rename ${file.original_name}`}
                          title="Rename file"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(file)}
                          aria-label={`Delete ${file.original_name}`}
                          title="Delete file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && !renaming) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              Choose a new name. The file extension stays the same.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submitRename(event)} className="space-y-5">
            <label className="block space-y-2 text-sm font-medium" htmlFor="rename-file-name">
              File name
              <span className="flex items-center gap-2">
                <Input
                  id="rename-file-name"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  autoFocus
                  maxLength={255}
                  disabled={renaming}
                />
                <span className="shrink-0 text-muted-foreground">
                  {renameTarget?.original_name.match(/\.[^.]+$/)?.[0] ?? ""}
                </span>
              </span>
            </label>
            {renameError && <p className="text-sm text-destructive" role="alert">{renameError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)} disabled={renaming}>
                Cancel
              </Button>
              <Button type="submit" disabled={renaming || !renameValue.trim()}>
                {renaming ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
