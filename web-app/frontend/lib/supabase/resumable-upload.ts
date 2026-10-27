import * as tus from "tus-js-client";
import { FILE_BUCKET } from "@/lib/files";

/** Upload an EEG file directly to Supabase, optionally reporting byte progress. */
export async function uploadResumableFile(
  file: File,
  storagePath: string,
  accessToken: string,
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void,
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
      onError: reject,
      onProgress,
      onSuccess() {
        resolve();
      },
    });
    upload.start();
  });
}
