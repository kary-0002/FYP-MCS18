export function getApiBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_NEUROSCOPE_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  throw new Error("Set NEXT_PUBLIC_API_BASE_URL to the analysis service URL.");
}
