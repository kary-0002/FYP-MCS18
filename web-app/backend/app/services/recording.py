import os
import shutil
import subprocess
import tempfile

from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from app.nicolet_metadata import extract_nicolet_metadata
from app.recording_metadata import extract_recording_metadata
from app.state import SOURCE_JOBS, create_analysis_session


load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_HOST = urlparse(SUPABASE_URL).hostname if SUPABASE_URL else None


def convert_nicolet_to_edf(source_path, work_dir):
    source_path = Path(source_path)

    output_dir = Path(work_dir) / "converted"
    output_dir.mkdir(parents=True, exist_ok=True)

    converter = shutil.which("nicolet-e2edf")

    if converter is None:
        raise RuntimeError("nicolet-e2edf executable could not be found.")

    result = subprocess.run(
        [
            converter,
            "--in",
            str(source_path),
            "--out",
            str(output_dir),
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Nicolet conversion failed: {message}")

    edf_files = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() == ".edf"
    ]

    if len(edf_files) != 1:
        raise RuntimeError(
            "Nicolet conversion did not produce exactly one EDF file."
        )

    return edf_files[0]


def download_saved_recording(url: str, destination: Path):
    if not SUPABASE_HOST:
        raise RuntimeError("SUPABASE_URL is not configured.")

    parsed = urlparse(url)

    if (
        parsed.scheme != "https"
        or parsed.hostname != SUPABASE_HOST
        or "/storage/v1/object/sign/" not in parsed.path
    ):
        raise ValueError("Invalid Supabase Storage URL.")

    request = Request(
        url,
        headers={"User-Agent": "MCS18-SeizureAI"},
    )

    try:
        with urlopen(request, timeout=60) as response:
            with destination.open("wb") as output:
                shutil.copyfileobj(
                    response,
                    output,
                    length=1024 * 1024,
                )

    except (HTTPError, URLError) as exc:
        raise RuntimeError(
            f"Could not download saved EEG recording: {exc}"
        ) from exc


def process_saved_source(job_id: str, url: str, filename: str):
    original_filename = Path(filename).name
    work_dir = None

    try:
        SOURCE_JOBS[job_id] = {
            "status": "running",
            "detail": None,
        }

        work_dir = tempfile.mkdtemp(prefix="eeg-analysis-")

        source_path = Path(work_dir) / original_filename

        download_saved_recording(url, source_path)

        nicolet_metadata = extract_nicolet_metadata(source_path)

        eeg_path = convert_nicolet_to_edf(
            source_path,
            work_dir,
        )

        recording_metadata = extract_recording_metadata(eeg_path)
        recording_metadata["nicolet"] = nicolet_metadata

        session_id = create_analysis_session(
            work_dir=work_dir,
            eeg_path=eeg_path,
            source_path=source_path,
            source_format="nicolet",
            original_filename=original_filename,
            nicolet_metadata=nicolet_metadata,
            recording_metadata=recording_metadata,
        )

        SOURCE_JOBS[job_id] = {
            "status": "completed",
            "session_id": session_id,
            "source_format": "nicolet",
            "edf_filename": Path(eeg_path).name,
            "recording_metadata": recording_metadata,
            "detail": None,
        }

    except Exception as exc:
        if work_dir is not None:
            shutil.rmtree(work_dir, ignore_errors=True)

        SOURCE_JOBS[job_id] = {
            "status": "failed",
            "detail": str(exc),
        }