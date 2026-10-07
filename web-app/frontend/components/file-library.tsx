"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { FileText, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  buildRecordingPaths,
  buildStoragePath,
  classifyFile,
  isNicoletSourceFile,
  FILE_BUCKET,
  MAX_FILE_BYTES,
  MAX_NICOLET_SOURCE_BYTES,
  type FileKind,
} from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface UserFileRow {
  id: string;
  kind: FileKind;
  original_name: string;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
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

  const loadFiles = useCallback(async () => {
    setLoading(true);
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
      setError("Only EDF (.edf) and Nicolet (.e) EEG recordings are supported.");
      return;
    }
    if (isNicolet && file.size > MAX_NICOLET_SOURCE_BYTES) {
      setError("Nicolet .e file is larger than the 5 GB limit.");
      return;
    }
    if (!isNicolet && file.size > MAX_FILE_BYTES) {
      setError("File is larger than the 500 MB limit.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You need to sign in before uploading.");
      return;
    }

    setUploading(true);
    try {
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

      const { error: uploadError } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(storagePath, file, {
          contentType: kind === "pdf" ? "application/pdf" : "application/octet-stream",
          upsert: false,
        });

      if (uploadError) throw uploadError;

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

  async function handleDelete(row: UserFileRow) {
    setError(null);
    const { error: storageError } = await supabase.storage
      .from(FILE_BUCKET)
      .remove([row.storage_path]);

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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Card
        className="cursor-pointer border border-dashed p-8 text-center transition-all hover:border-primary hover:bg-primary/5"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void uploadFile(file);
        }}
        onClick={() => document.getElementById("document-upload")?.click()}
      >
        <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Upload an EEG recording</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Accepted: EDF (.edf) and Nicolet (.e)
        </p>
        <input
          id="document-upload"
          type="file"
          accept=".edf,.e"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
            event.target.value = "";
          }}
        />
        {uploading && (
          <p className="mt-3 text-sm text-muted-foreground">Uploading...</p>
        )}
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading files...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No files stored yet. Local viewing still works without uploading.
          </p>
        ) : (
          files.map((file) => (
            <Card
              key={file.id}
              className="flex min-h-28 flex-col items-start justify-between gap-4 p-4 transition-all hover:border-primary/60 hover:bg-primary/5"
            >
              <div className="flex w-full min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p
                    className="block max-w-full truncate text-sm font-medium"
                    title={file.original_name.replace(/\.edf$/i, "")}
                  >
                    {file.original_name.replace(/\.edf$/i, "")}
                  </p>
                  <p className="text-xs text-muted-foreground uppercase">
                    {file.kind === "edf" ? "EEG recording" : "PDF Report"}
                  </p>
                </div>
              </div>
              <div className="flex w-full shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-primary/40 bg-secondary text-foreground hover:border-primary hover:bg-accent dark:border-primary/50 dark:bg-muted dark:hover:bg-accent"
                  onClick={() => void handleDownload(file)}
                >
                  Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-destructive/40 bg-destructive/10 text-destructive hover:border-destructive hover:bg-destructive/20 hover:text-destructive"
                  onClick={() => void handleDelete(file)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
