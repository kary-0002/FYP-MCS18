# Web App Endpoint Inventory

This inventory covers the Next.js frontend routes, the FastAPI analysis service, and the Supabase resources the frontend uses. Paths are relative to the frontend origin or the configured analysis API base URL unless stated otherwise.

## Frontend routes

| Method | Path | Purpose / behavior | Notes |
|---|---|---|---|
| GET | `/` | Landing page with links into the EEG workspace. | The page contains a commented-out link to `/canvas`; no `/canvas` route currently exists. |
| GET | `/edf-reader` | EEG reader and file review page. | Accepts `?file=<user_files.id>` to open a saved EDF. Renders the NeuroScope viewer as a native React component. |
| GET | `/files` | User file library; browse, upload, rename, download, and assign recordings. | Upload/storage operations use Supabase. Nicolet conversion uses the analysis API. |
| GET | `/patients` | Patient directory and patient creation. | Uses Supabase `patients` and `user_files`. |
| GET | `/patients/:id` | Patient profile, assigned recordings, trends, and patient management. | `:id` is a Supabase patient UUID. |
| GET | `/results` | Results demonstration page. | Currently populated with mock results; not backed by the FastAPI `/results/:session_id` endpoint. |
| GET | `/login` | Sign-in form. | Supports password and configured OAuth sign-in. `?next=` controls the post-login destination. |
| GET | `/signup` | Account registration form. | Uses Supabase Auth. |
| GET | `/auth/callback?code=…&next=…` | Exchanges the Supabase OAuth authorization code for a session, then redirects. | Invalid/missing codes redirect to `/login?error=auth`. |

## Analysis API (FastAPI backend)

Base URL comes from `NEXT_PUBLIC_API_BASE_URL` (legacy fallback: `NEXT_PUBLIC_NEUROSCOPE_API_BASE_URL`); development defaults to `http://127.0.0.1:8000`. The backend is in `backend/app/main.py` and has no common `/api` prefix.

| Method | Path | Used by frontend? | Purpose |
|---|---|---|---|
| GET | `/` | Defined; not called by the frontend | Basic service response (`Home Page`). |
| POST | `/upload` | Yes | Uploads an EDF or Nicolet `.e`; converts Nicolet files, creates an in-memory analysis session, and returns session ID, EDF filename, source format, and metadata. Multipart field: `veeg`. |
| POST | `/open-saved-recording` | Yes | Creates an analysis session from a saved EDF URL. JSON body: `{ "url", "filename" }`. |
| POST | `/open-saved-source` | Yes | Starts asynchronous conversion of a saved Nicolet `.e` source. JSON body: `{ "url", "filename" }`; returns a job ID. |
| GET | `/source-job/{job_id}` | Yes | Polls the status and result of a saved Nicolet conversion job. |
| GET | `/edf/{session_id}` | Yes | Downloads the converted/current EDF for an analysis session. |
| POST | `/seizure-detection/{session_id}` | Yes | Runs seizure detection; returns status and seizure-detection result. |
| POST | `/background-analysis/{session_id}` | Yes | Runs background analysis and returns metadata and analysis summary. |
| GET | `/analysis-progress/{session_id}/{task}` | Yes | Polls background-analysis or report progress (`task` is `background` or `report`). The frontend polls about every 700 ms. |
| POST | `/report` | Yes | Generates a PDF report. Multipart fields: `session_id`, `seizure_results_json`, `annotation_results_json`, `seizure_detection_status`, and optional `recording_metadata_json`. |
| GET | `/results/{session_id}` | Defined; not called by the frontend | Minimal legacy response containing the session ID. |

## Supabase resources used by the frontend

These are service resources accessed through the Supabase SDK rather than Next.js routes.

| Resource | Operations / purpose |
|---|---|
| Auth | Read current user/session; password sign-in; account sign-up; OAuth sign-in; OAuth callback code exchange; sign-out; auth-state subscription. |
| `user_files` table | List and insert files; retrieve file metadata; rename/update metadata; delete entries; assign/unassign a patient; check duplicate EDF uploads. |
| `patients` table | List and create patient profiles; read/update/delete profiles; count assigned recordings. |
| Storage bucket `user-files` | Upload, download, create signed URLs, and remove user files. Recording bundles use `<user-id>/recordings/<recording-key>/` with `source.e`, `recording.edf`, `recording_state.json`, and `latest_report.pdf`. Standalone uploads use EDF/report subfolders. |
| Supabase resumable Storage upload | TUS uploads use `https://<project-ref>.storage.supabase.co/storage/v1/upload/resumable`. |

## Notes

- The backend keeps analysis sessions and progress in process memory. Session IDs are temporary and are not the same as Supabase file IDs.
- The browser's `/edf-reader?file=…` route loads the saved file from Supabase; analysis endpoints then create/use a backend analysis session as needed.
- NeuroScope is rendered directly inside `/edf-reader`; it no longer has a separate frontend endpoint or iframe message bridge. The active recording is held by a provider in the persistent app layout while the user navigates between frontend routes.
