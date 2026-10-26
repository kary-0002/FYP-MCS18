# Web App Endpoint Inventory

This document lists the routes exposed by the Next.js frontend, the FastAPI analysis service, and the Supabase resources used by the app. Frontend paths are relative to the web app origin. Analysis API paths are relative to the configured FastAPI base URL.

## Frontend routes

| Method | Path | Purpose and behavior |
|---|---|---|
| `GET` | `/` | Landing page and workspace navigation. The page currently links to `/canvas`, but there is no `/canvas` route in the App Router. |
| `GET` | `/edf-reader` | Native React EEG reader, annotation, analysis, and report workspace. Accepts `?file=<user_files.id>` to load a saved EDF from Supabase. NeuroScope is rendered as a component here; `/neuroscope` is not a route. |
| `GET` | `/files` | User file library for uploading, browsing, renaming, downloading, deleting, and assigning EEG files and reports. |
| `GET` | `/patients` | Patient directory and patient creation. |
| `GET` | `/patients/:id` | Patient profile, assigned recordings, trends, and patient management. `:id` is a Supabase patient UUID. |
| `GET` | `/results` | Results demonstration page currently populated with mock data. It does not call the FastAPI `/results/{session_id}` route. |
| `GET` | `/login` | Password sign-in and configured OAuth sign-in. Supports `?next=` for the post-login destination. |
| `GET` | `/signup` | Account registration through Supabase Auth. |
| `GET` | `/auth/callback?code=…&next=…` | Next.js route handler exchanges the Supabase OAuth authorization code for a session and redirects. Invalid or missing codes redirect to `/login?error=auth`. |

`proxy.ts` delegates to Supabase session middleware. It refreshes auth cookies and redirects unauthenticated requests under `/edf-reader`, `/files`, and `/patients` to `/login?next=…` when Supabase environment variables are configured.

## FastAPI analysis API

The service is implemented in `backend/app/main.py` and has no shared `/api` prefix. The frontend base URL is read from `NEXT_PUBLIC_API_BASE_URL`; `NEXT_PUBLIC_NEUROSCOPE_API_BASE_URL` remains as a legacy fallback. Development defaults to `http://127.0.0.1:8000`; production requires `NEXT_PUBLIC_API_BASE_URL`.

| Method | Path | Frontend use | Purpose and request details |
|---|---|---|---|
| `GET` | `/` | No | Basic service response. |
| `POST` | `/upload` | Yes | Upload an EDF or Nicolet `.e` and create an in-memory analysis session. Multipart field: `veeg`. A Nicolet file is converted to EDF. |
| `POST` | `/open-saved-recording` | Yes | Create an analysis session from a saved EDF URL. JSON body: `{ "url", "filename" }`. |
| `POST` | `/open-saved-source` | Yes | Queue conversion for a saved Nicolet `.e` source. JSON body: `{ "url", "filename" }`; returns a job ID. |
| `GET` | `/source-job/{job_id}` | Yes | Read queued, running, completed, or failed Nicolet conversion status and result. |
| `GET` | `/edf/{session_id}` | Yes | Download the EDF associated with an analysis session. |
| `POST` | `/seizure-detection/{session_id}` | Yes | Run seizure detection and return the detection status and result. |
| `POST` | `/background-analysis/{session_id}` | Yes | Run EEG background analysis and return recording metadata and the analysis result. |
| `GET` | `/analysis-progress/{session_id}/{task}` | Yes | Read progress events for `background` or `report`; the frontend polls this endpoint while those tasks run. The backend rejects other task names. |
| `POST` | `/report` | Yes | Generate a PDF report. Multipart fields: `session_id`, `seizure_results_json`, `annotation_results_json`, `seizure_detection_status`, and optional `recording_metadata_json`. |
| `GET` | `/results/{session_id}` | No | Legacy endpoint returning the supplied session ID. |
| `GET` | `/docs` | No | FastAPI-generated Swagger UI. |
| `GET` | `/redoc` | No | FastAPI-generated ReDoc API reference. |
| `GET` | `/openapi.json` | No | FastAPI-generated OpenAPI schema. |

**Progress polling note:** the viewer also starts a progress watcher for seizure detection, but `/analysis-progress` currently accepts only `background` and `report`. Seizure detection runs through its POST request and does not currently expose progress through that endpoint.

## Supabase resources

These are Supabase service resources accessed through the SDK or the Supabase Storage HTTP APIs; they are not Next.js routes.

| Resource | Operations used |
|---|---|
| Supabase Auth | Read the current user and session; password sign-in; sign-up; OAuth sign-in; OAuth code exchange; sign-out; auth-state subscription. |
| `user_files` table | List and insert file records; read metadata; rename/update metadata; delete records; assign or unassign patients; check for duplicate EEG files. |
| `patients` table | List, create, read, update, and delete patient records; count/list assigned EEG files. |
| Storage bucket `user-files` | Upload, download, create signed URLs, and remove EDF, Nicolet source, report, and recording-state objects. Recording bundles use `<user-id>/recordings/<recording-key>/` with `source.e`, `recording.edf`, `recording_state.json`, and `latest_report.pdf`. Standalone files use per-user `edf/` and `reports/` folders. |
| Supabase resumable Storage API | TUS uploads use `https://<project-ref>.storage.supabase.co/storage/v1/upload/resumable`. |

## Runtime notes

- FastAPI analysis sessions, source-conversion jobs, and progress are stored in process memory. Session IDs are temporary and distinct from Supabase `user_files` IDs.
- Opening `/edf-reader?file=…` downloads the saved EDF from Supabase. The viewer creates an analysis session through FastAPI when analysis or report generation requires one.
- The active recording session is held by `NeuroScopeSessionProvider` in the persistent app layout while the user navigates between frontend routes.
- FastAPI CORS origins are controlled by `FRONTEND_ORIGINS`; localhost development origins are also allowed by the backend.
