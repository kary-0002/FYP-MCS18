# [MCS18 FYP] - SeizureAI: Web-based EEG Viewer, Annotator, and Feedback Recommendations

## 👥 Members
**Core:**
- Jason Yeap Kang Sheng [34277579]
- Jota Nishimura [34303995]
- Kristofer Astro Aryapradipta [34091971]
- Prawin Raj [34506209]

**Supervisor:**
- Dr. Jessie Leong Shu Min

## 📝 Project Description:
This Final Year project aims to develop a web-based platform to view and annotate EEG (electroencephalogram) files in `.edf` / `.e` (Nicolet) format, as well as generating a report containing AI-assisted analysis and feedback recommendations using a pre-trained model based on the Siena EEG public dataset.

## 🚀 Features
- View EEG recordings from `.edf` / `.e` (NicoletEEG) files in the browser
- Annotate EEG signals and assign pre-defined labels
- Report generation feature: Containing AI-assisted analysis, feedback recommendations, graphs, diagrams and summaries
- Store `.edf` recordings and `.pdf` reports using Supabase-based database and built-in file management system
- Patients profiling and management feature to assign EEG recordings to patients and gain insights through statistical analysis

## 🤖 Models Used
- [Tung EEG](https://github.com/tcs211/AI_EEEG_REPORT) (based on TUH EEG dataset), for Report Generation
- [SeizureTransformer](https://github.com/keruiwu/SeizureTransformer), for Seizure Detection


## ⚙️ Technical Stack

| Category       | Libraries / Frameworks                 |
| -------------- | -------------------------------------- |
| Frontend       | Next.js, React                         |
| Backend        | Supabase (Auth + File Storage), FastAPI (pre-trained models)     |


## 📦 Project Structure

```
web-app/
├─ backend/                         # FastAPI analysis and report-generation service
│  ├─ app/
│  │  ├─ main.py                    # FastAPI routes and request handling
│  │  ├─ state.py                   # Shared analysis sessions, jobs, and progress state
│  │  ├─ recording_metadata.py      # EDF recording metadata extraction
│  │  ├─ seizure_detection.py       # Seizure detection pipeline
│  │  ├─ nicolet_metadata.py        # Nicolet .e metadata extraction
│  │  ├─ model.py                   # Model support
│  │  ├─ services/
│  │  │  ├─ __init__.py
│  │  │  ├─ progress.py             # Background/report progress tracking
│  │  │  └─ recording.py            # Recording download, conversion, and preparation
│  │  ├─ official_seizure_transformer_model.pth
│  │  └─ report_generation/
│  │     ├─ *.py                    # EEG features, analysis, and PDF report generation
│  │     └─ models/                 # Pre-trained report model weights
│  ├─ pyproject.toml                # Python dependencies and project configuration
│  └─ uv.lock                       # Locked Python dependencies
│
└─ frontend/                        # Next.js App Router application
   ├─ app/                          # Pages and the Supabase OAuth callback route
   ├─ components/
   │  ├─ neuroscope/                # Native React EDF viewer, session state, and styles
   │  └─ ui/                        # Shared UI components
   ├─ hooks/                        # Shared React hooks
   ├─ lib/
   │  ├─ neuroscope/                # EDF parsing, API client, and file identity
   │  └─ supabase/                  # Auth clients, middleware, and resumable uploads
   ├─ public/                       # Static assets
   ├─ styles/                       # Global styles
   └─ types/                        # Type declarations
```

The frontend route tree and backend API are documented in [web-app/ENDPOINTS.md](web-app/ENDPOINTS.md).

## Running locally

Run the frontend and backend in separate terminals. Use `web-app/`, rather than the older prototypes in `archive/`.

### Frontend

Install Node.js compatible with the locked Next.js version (Node.js 20.9 or later) and npm. From the repository root:

```sh
cd web-app/frontend
npm ci
cp .env.example .env.local
```

Add the following to `.env.local`, using the same Supabase project as the backend:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
```

```sh
npm run dev
```

Open `http://localhost:3000`. Sign in to access `/edf-reader`, `/files`, and `/patients`. The Supabase project must already have the `user_files` and `patients` tables, the `user-files` Storage bucket, and the appropriate access policies; this repository does not include provisioning migrations. OAuth also requires the project's redirect URLs to be configured.

### Backend

Install [uv](https://docs.astral.sh/uv/) and use Python 3.11–3.13, as required by `pyproject.toml`:

```sh
cd web-app/backend
uv sync --python 3.12
uv run fastapi dev app/main.py
```

Configure `web-app/backend/.env` with `SUPABASE_URL` matching the frontend project. `GOOGLE_API_KEY` enables AI-generated report text; without it, the report builder uses EEG findings. `FRONTEND_ORIGINS` accepts comma-separated deployed frontend origins; local development origins are already allowed.

Seizure detection requires `app/official_seizure_transformer_model.pth`, or a custom `SEIZURE_MODEL_PATH`. The default checkpoint is ignored by Git and must be supplied separately. Report model weights are under `app/report_generation/models/`. Start the backend from its directory so relative paths resolve correctly. The API is available at `http://127.0.0.1:8000`, with interactive documentation at `/docs`.

## Frontend organization and readability refactor

The EEG workflow is split across these files:

| File | Responsibility |
| --- | --- |
| `app/edf-reader/page.tsx` | Coordinate saved recordings, patient assignment, autosave, and PDF preview. |
| `components/neuroscope/neuroscope-viewer.tsx` | Manage viewer controls, annotations, analysis tasks, and recording-state import/export. |
| `components/neuroscope/edf-viewer.tsx` | Render the waveform, channel sidebar, upload screen, and annotation dialog. |
| `components/neuroscope/neuroscope-session.tsx` | Keep the active recording available across route navigation through the provider in `app/layout.tsx`. |
| `components/file-library.tsx` | Manage the user's uploaded recordings and reports. |
| `lib/neuroscope/` | Parse EDF data, identify recordings, and communicate with FastAPI. |
| `lib/supabase/` | Create Supabase clients, refresh authentication, and perform resumable uploads. |

The readability refactor extracts two operations previously duplicated in the EEG reader and file library:

- **Resumable uploads:** `lib/supabase/resumable-upload.ts` provides `uploadResumableFile`, with an optional byte-progress callback. The file library keeps its progress text in the component; the shared helper owns the TUS connection and upload settings.
- **Nicolet conversion polling:** `waitForNicoletSourceJob` in `lib/neuroscope/api.ts` provides one implementation for waiting on queued conversion jobs and reporting failures or timeouts.

This reduces duplication and makes both entry points easier to follow. Uploads retain the same bucket, authorization, metadata, 6 MiB chunks, and retry delays. Conversion polling retains its two-second interval, 1,800-attempt limit, and error messages. Recording-state formats, database operations, routes, and UI behavior are unchanged by this refactor.

### Validation

From `web-app/frontend`:

```sh
npx tsc --noEmit --incremental false
npm run build
```

Run TypeScript separately: `next.config.mjs` currently sets `typescript.ignoreBuildErrors: true`, so a successful build alone does not establish type safety. The build also fetches Geist fonts from Google Fonts and needs network access. `npm run lint` currently references ESLint, but the project does not declare ESLint or provide its configuration.

For a manual regression check, open an EDF in the viewer, verify automatic saving, navigate away and return, edit an annotation, and reopen the saved recording from My Files. Also check upload progress and Nicolet `.e` conversion from both entry points, patient assignment, and PDF generation. These checks require a configured Supabase project, a running backend, the relevant model files, and sample recordings.
