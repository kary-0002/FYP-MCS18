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
   │  └─ supabase/                  # Supabase browser, server, and middleware clients
   ├─ public/                       # Static assets
   ├─ styles/                       # Global styles
   └─ types/                        # Type declarations                     # Type declarations
```

The frontend route tree and backend API are documented in [web-app/ENDPOINTS.md](web-app/ENDPOINTS.md).
