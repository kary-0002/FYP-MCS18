from uuid import uuid4


ANALYSIS_SESSIONS = {}
SOURCE_JOBS = {}
ANALYSIS_PROGRESS = {}


def create_analysis_session(
    work_dir,
    eeg_path,
    source_path,
    source_format,
    original_filename,
    nicolet_metadata,
    recording_metadata,
):
    session_id = str(uuid4())

    ANALYSIS_SESSIONS[session_id] = {
        "work_dir": work_dir,
        "eeg_path": str(eeg_path),
        "source_path": str(source_path),
        "source_format": source_format,
        "original_filename": original_filename,
        "nicolet_metadata": nicolet_metadata,
        "report": None,
        "recording_metadata": recording_metadata,
        "background_analysis": None,
    }

    return session_id