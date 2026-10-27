import os
import tempfile
import shutil
import json
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from pydantic import BaseModel
from app.seizure_detection import detect_seizures
from app.nicolet_metadata import extract_nicolet_metadata
from app.report_generation.mcs18_pipeline import (
    generate_report_from_analysis,
    prepare_analysis,
)
from app.recording_metadata import extract_recording_metadata

from app.state import (
    ANALYSIS_SESSIONS,
    SOURCE_JOBS,
    ANALYSIS_PROGRESS,
    create_analysis_session,
)
from app.services.progress import (
    begin_analysis_progress,
    update_analysis_progress,
)
from app.services.recording import (
    convert_nicolet_to_edf,
    download_saved_recording,
    process_saved_source,
)

load_dotenv()
app = FastAPI()

configured_frontend_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_frontend_origins + [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.getenv(
    "SEIZURE_MODEL_PATH",
    "app/official_seizure_transformer_model.pth"
)



@app.get("/analysis-progress/{session_id}/{task}")
async def get_analysis_progress(session_id: str, task: str):
    if task not in {"background", "report"}:
        raise HTTPException(status_code=400, detail="Unknown analysis task.")
    return ANALYSIS_PROGRESS.get((session_id, task), {
        "status": "idle", "percent": None, "message": None, "events": []
    })



class SavedRecordingRequest(BaseModel):
    url: str
    filename: str


# API ENDPOINTS
@app.get("/")
async def get_home():
    return {"message": "Home Page"}


@app.post("/upload")
async def post_upload_veeg(
    veeg: UploadFile = File(...)
):
    original_filename = Path(veeg.filename or "").name
    # Validate EDF/E file
    suffix = Path(original_filename).suffix.lower()
    if suffix not in {".edf", ".e"}:
        raise HTTPException(
            status_code=400,
            detail="Only EDF and Nicolet .e files are supported.",
        )

    work_dir = tempfile.mkdtemp(prefix="eeg-analysis-")
    source_path = Path(work_dir) / original_filename

    try:
        with source_path.open("wb") as temp_file:
            shutil.copyfileobj(veeg.file, temp_file)

        nicolet_metadata = None
        if suffix == ".e":
            source_format = "nicolet"
            nicolet_metadata = extract_nicolet_metadata(source_path)
            eeg_path = convert_nicolet_to_edf(source_path, work_dir)
        else:
            source_format = "edf"
            eeg_path = source_path

        recording_metadata = extract_recording_metadata(eeg_path)
        if nicolet_metadata is not None:
            recording_metadata["nicolet"] = nicolet_metadata
        
        session_id = create_analysis_session(
            work_dir=work_dir,
            eeg_path=eeg_path,
            source_path=source_path,
            source_format=source_format,
            original_filename=original_filename,
            nicolet_metadata=nicolet_metadata,
            recording_metadata=recording_metadata,
        )
        return {
            "session_id": session_id,
            "source_format": source_format,
            "edf_filename": Path(eeg_path).name,
            "recording_metadata": recording_metadata
        }

    except Exception as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


@app.post("/open-saved-recording")
def post_open_saved_recording(request: SavedRecordingRequest):
    original_filename = Path(request.filename).name
    if Path(original_filename).suffix.lower() != ".edf":
        raise HTTPException(status_code=400, detail="Saved recording must be an EDF file.")
    work_dir = tempfile.mkdtemp(prefix="eeg-analysis-")
    eeg_path = Path(work_dir) / original_filename
    try:
        download_saved_recording(request.url, eeg_path)
        recording_metadata = extract_recording_metadata(eeg_path)
        session_id = create_analysis_session(
            work_dir=work_dir,
            eeg_path=eeg_path,
            source_path=eeg_path,
            source_format="edf",
            original_filename=original_filename,
            nicolet_metadata=None,
            recording_metadata=recording_metadata,
        )
        return {
            "session_id": session_id,
            "source_format": "edf",
            "edf_filename": original_filename,
            "recording_metadata": recording_metadata
        }
    except ValueError as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/open-saved-source")
def post_open_saved_source(request: SavedRecordingRequest, background_tasks: BackgroundTasks):
    original_filename = Path(request.filename).name
    if Path(original_filename).suffix.lower() != ".e":
        raise HTTPException(status_code=400, detail="Saved source must be a Nicolet .e file.")
    job_id = str(uuid4())
    SOURCE_JOBS[job_id] = {
        "status": "queued",
        "detail": None
    }
    background_tasks.add_task(
        process_saved_source,
        job_id,
        request.url,
        original_filename
    )
    return {
        "job_id": job_id,
        "status": "queued"
    }


@app.get("/source-job/{job_id}")
def get_source_job(job_id: str):
    job = SOURCE_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Nicolet conversion job not found.")
    return {
        "job_id": job_id,
        **job
    }


@app.get("/edf/{session_id}")
async def get_session_edf(session_id: str):
    session = ANALYSIS_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis session not found or expired."
        )

    eeg_path = Path(session["eeg_path"])
    return FileResponse(
        path=eeg_path,
        media_type="application/octet-stream",
        filename=eeg_path.name
    )


@app.post("/seizure-detection/{session_id}")
async def post_seizure_detection(session_id: str):
    session = ANALYSIS_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis session not found or expired."
        )

    try:
        # Run seizure detection
        result = detect_seizures(
            edf_path=session["eeg_path"],
            checkpoint_path=MODEL_PATH,
            threshold=0.25
        )
        # Keep the original uploaded filename in the response
        result["file"] = Path(session["eeg_path"]).name
        return {
            "status": "completed",
            "seizure_detection": result
        }
    except Exception as exc:
        print("Seizure detection failed:", exc)
        return {
            "status": "failed",
            "seizure_detection": None
        }


@app.post("/background-analysis/{session_id}")
async def post_background_analysis(session_id: str):
    session = ANALYSIS_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis session not found or expired."
        )

    try:
        progress_callback = begin_analysis_progress(session_id, "background")
        progress_callback(None, "Starting EEG background analysis")
        analysis = await run_in_threadpool(
            prepare_analysis,
            session["eeg_path"],
            nicolet_metadata=session["nicolet_metadata"],
            progress_callback=progress_callback
        )
        session["report"] = analysis["report"]
        session["recording_metadata"] = analysis["recording_metadata"]
        session["background_analysis"] = analysis["background_analysis"]
        update_analysis_progress(session_id, "background", 100, "Background analysis complete", "completed")
        return {
            "status": "completed",
            "recording_metadata": analysis["recording_metadata"],
            "background_analysis": analysis["background_analysis"]
        }

    except Exception as exc:
        update_analysis_progress(session_id, "background", None, f"Background analysis failed: {exc}", "failed")
        print("Background analysis failed:", exc)
        return {
            "status": "failed",
            "detail": str(exc)
        }


@app.post("/report")
async def post_generate_report(
    session_id: str = Form(...),
    seizure_results_json: str = Form(...),
    annotation_results_json: str = Form(...),
    seizure_detection_status: str = Form(...),
    recording_metadata_json: str = Form("{}")
):
    session = ANALYSIS_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis session not found or expired."
        )
    if session["recording_metadata"] is None:
        raise HTTPException(
            status_code=409,
            detail="Recording metadata is unavailable."
        )

    try:
        seizure_results = json.loads(seizure_results_json)
        annotation_results = json.loads(annotation_results_json)
        viewer_recording_metadata = json.loads(recording_metadata_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid seizure or annotation JSON."
        )

    viewer_nicolet_metadata = (
        viewer_recording_metadata.get("nicolet")
        if isinstance(viewer_recording_metadata, dict)
        else None
    )

    if viewer_nicolet_metadata:
        session["nicolet_metadata"] = viewer_nicolet_metadata
        session["recording_metadata"] = {
            **(session["recording_metadata"] or {}),
            "nicolet": viewer_nicolet_metadata
        }

    try:
        progress_callback = begin_analysis_progress(session_id, "report")
        progress_callback(0, "Starting report generation")
        def report_generation_progress(percent, message):
            scaled_percent = None if percent is None else 45 + int(percent * 0.55)
            progress_callback(scaled_percent, message)

        if session["report"] is None:
            progress_callback(None, "Running EEG analysis required for the report")
            def report_analysis_progress(percent, message):
                progress_callback(None, message)

            analysis = await run_in_threadpool(
                prepare_analysis,
                session["eeg_path"],
                nicolet_metadata=session["nicolet_metadata"],
                progress_callback=report_analysis_progress
            )
            session["report"] = analysis["report"]
            session["recording_metadata"] = analysis["recording_metadata"]
            session["background_analysis"] = analysis["background_analysis"]

        result = await run_in_threadpool(
            generate_report_from_analysis,
            report=session["report"],
            eeg_path=session["eeg_path"],
            recording_metadata=session["recording_metadata"],
            seizure_results=seizure_results,
            annotation_results=annotation_results,
            seizure_detection_status=seizure_detection_status,
            output_root=session["work_dir"],
            progress_callback=report_generation_progress
        )
        update_analysis_progress(session_id, "report", 100, "Report PDF ready", "completed")
        pdf_path = result["pdf_path"]
        original_filename = session["original_filename"]

        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"{Path(original_filename).stem}_report.pdf"
        )

    except ValueError as exc:
        update_analysis_progress(session_id, "report", None, f"Report generation failed: {exc}", "failed")
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        update_analysis_progress(session_id, "report", None, f"Report generation failed: {exc}", "failed")
        raise HTTPException(status_code=500, detail=str(exc))

    


@app.get("/results/{session_id}")
async def get_results_by_id(session_id: str):
    return {"id": session_id}
