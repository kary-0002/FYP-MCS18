"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { createClient } from "@/lib/supabase/client";
import { FILE_BUCKET } from "@/lib/files";

function EDFReaderContent() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get("file");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [savedFile, setSavedFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          .createSignedUrl(row.storage_path, 300);

        if (signedError || !data?.signedUrl) {
          throw signedError ?? new Error("Could not open the saved EDF file.");
        }

        if (!cancelled) setSavedFile({ url: data.signedUrl, name: row.original_name });
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
      { type: "neuroscope:open-edf", ...savedFile },
      window.location.origin,
    );
  }, [savedFile]);

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
    const handleViewerReady = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "seizureai:viewer-ready") {
        syncTheme();
      }
    };
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("message", handleViewerReady);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", handleViewerReady);
    };
  }, [syncTheme]);

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
