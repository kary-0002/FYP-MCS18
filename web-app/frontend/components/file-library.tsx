"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  buildStoragePath,
  classifyFile,
  FILE_BUCKET,
  MAX_FILE_BYTES,
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

export function FileLibrary() {
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

  async function uploadFile(file: File) {
    setError(null);
    setStatus(null);

    const kind = classifyFile(file);
    if (!kind) {
      setError("Only .edf EEG files and .pdf reports can be stored.");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
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
    const storagePath = buildStoragePath(user.id, kind, file.name);

    try {
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
        <p className="font-medium">Upload an EEG file or PDF report</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Accepted: .edf (up to 500 MB) and .pdf
        </p>
        <input
          id="document-upload"
          type="file"
          accept=".edf,.pdf,application/pdf"
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
              className="flex min-h-36 flex-col items-start justify-between gap-4 p-4 transition-all hover:border-primary/60 hover:bg-primary/5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{file.original_name}</p>
                  <p className="text-xs text-muted-foreground uppercase">
                    {file.kind === "edf" ? "EEG (.edf)" : "Report (.pdf)"}
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
