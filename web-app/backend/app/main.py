import os
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.seizure_detection import detect_seizures


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


@app.get("/results/{session_id}")
async def get_results_by_id(session_id: str):
    return {"id": session_id}