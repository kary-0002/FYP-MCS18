import os
import tempfile
import shutil
import json
from uuid import uuid4
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from app.seizure_detection import detect_seizures
from app.report_generation.mcs18_pipeline import generate_report_from_analysis, prepare_analysis


app = FastAPI()

# Setting up CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://fyp.azutoro.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ANALYSIS_SESSIONS = {}
MODEL_PATH = os.getenv(
    "SEIZURE_MODEL_PATH",
    "app/official_seizure_transformer_model.pth"
)


# API ENDPOINTS
@app.get("/")
async def get_home():
    return {"message": "Home Page"}


@app.post("/upload")
async def post_upload_veeg(
    veeg: UploadFile = File(...)
):
    original_filename = Path(veeg.filename or "").name
    # Validate EDF file
    if not original_filename.lower().endswith(".edf"):
        raise HTTPException(
            status_code=400,
            detail="Only EDF files are supported."
        )

    work_dir = tempfile.mkdtemp(prefix="eeg-analysis-")
    eeg_path = os.path.join(work_dir, original_filename)

    try:
        content = await veeg.read()
        with open(eeg_path, "wb") as temp_file:
            temp_file.write(content)
        
        session_id = str(uuid4())
        ANALYSIS_SESSIONS[session_id] = {
            "work_dir": work_dir,
            "eeg_path": eeg_path,
            "original_filename": original_filename,
            "report": None,
            "recording_metadata": None
        }
        return {"session_id": session_id}

    except Exception as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=str(exc)
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
            threshold=0.2
        )
        # Keep the original uploaded filename in the response
        result["file"] = session["original_filename"]
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
        analysis = prepare_analysis(session["eeg_path"])
        session["report"] = analysis["report"]
        session["recording_metadata"] = analysis["recording_metadata"]
        return {"status": "completed"}

    except Exception as exc:
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
    seizure_detection_status: str = Form(...)
):
    session = ANALYSIS_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis session not found or expired."
        )
    if (
        session["report"] is None
        or session["recording_metadata"] is None
    ):
        raise HTTPException(
            status_code=409,
            detail="Background analysis has not completed."
        )

    try:
        seizure_results = json.loads(seizure_results_json)
        annotation_results = json.loads(annotation_results_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid seizure or annotation JSON."
        )

    try:
        result = generate_report_from_analysis(
            report=session["report"],
            eeg_path=session["eeg_path"],
            recording_metadata=session["recording_metadata"],
            seizure_results=seizure_results,
            annotation_results=annotation_results,
            seizure_detection_status=seizure_detection_status,
            output_root=session["work_dir"]
        )
        pdf_path = result["pdf_path"]
        original_filename = session["original_filename"]

        def cleanup():
            ANALYSIS_SESSIONS.pop(session_id, None)
            shutil.rmtree(session["work_dir"], ignore_errors=True)

        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"{Path(original_filename).stem}_report.pdf",
            background=BackgroundTask(cleanup)
        )

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/results/{session_id}")
async def get_results_by_id(session_id: str):
    return {"id": session_id}