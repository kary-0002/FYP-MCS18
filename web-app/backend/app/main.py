import os
import tempfile
import shutil
import json
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from app.seizure_detection import detect_seizures
from app.report_generation.mcs18_pipeline import run_pipeline


app = FastAPI()

# Setting up CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
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


# API ENDPOINTS
@app.get("/")
async def get_home():
    return {"message": "Home Page"}


@app.post("/upload")
async def post_upload_veeg(
    veeg: UploadFile = File(...)
):
    # Validate EDF file
    if not veeg.filename.lower().endswith(".edf"):
        raise HTTPException(
            status_code=400,
            detail="Only EDF files are supported."
        )

    temp_path = None

    try:
        # Save uploaded EDF temporarily
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".edf"
        ) as temp_file:
            content = await veeg.read()
            temp_file.write(content)
            temp_path = temp_file.name

        # Run seizure detection
        result = detect_seizures(
            edf_path=temp_path,
            checkpoint_path=MODEL_PATH,
            threshold=0.2
        )

        # Keep the original uploaded filename in the response
        result["file"] = veeg.filename

        return result

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )

    finally:
        # Remove temporary EDF file
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/report")
async def post_generate_report(
    veeg: UploadFile = File(...),
    seizure_results_json: str = Form(...),
    annotation_results_json: str = Form(...),
):
    original_filename = Path(veeg.filename or "").name

    if not original_filename.lower().endswith(".edf"):
        raise HTTPException(
            status_code=400,
            detail="Only EDF files are supported."
        )

    try:
        seizure_results = json.loads(seizure_results_json)
        annotation_results = json.loads(annotation_results_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid seizure or annotation JSON."
        )

    work_dir = tempfile.mkdtemp(prefix="eeg-report-")
    try:
        temp_path = os.path.join(work_dir, original_filename)
        content = await veeg.read()
        with open(temp_path, "wb") as temp_file:
            temp_file.write(content)

        result = run_pipeline(
            eeg_path=temp_path,
            seizure_results=seizure_results,
            annotation_results=annotation_results,
            output_root=work_dir
        )
        pdf_path = result["pdf_path"]

        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"{Path(original_filename).stem}_report.pdf",
            background=BackgroundTask(shutil.rmtree, work_dir, ignore_errors=True)
        )

    except ValueError as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/results/{session_id}")
async def get_results_by_id(session_id: str):
    return {"id": session_id}