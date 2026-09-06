import os
from pathlib import Path

from dotenv import load_dotenv
from .auto_report import CreateReport

REPORTING_DIR = Path(__file__).resolve().parent
MODEL_DIR = REPORTING_DIR / "models"


def analyze_eeg(eeg_path):
    """
    Run Tung's automated EEG background analysis.

    Parameters
    ----------
    eeg_path : str
        Path to an EDF recording.

    Returns
    -------
    dict
        Structured MCS18 background-analysis result.
    """
    eeg_path = Path(eeg_path)

    report = CreateReport(
        eeg_path.name,
        str(eeg_path.parent),
        model_folder=str(MODEL_DIR)
    )

    return {
        "recording_id": eeg_path.stem,
        "background_analysis": report.finalResults
    }


def adapt_seizure_results(seizure_results):
    """
    Adapter for the seizure-detection output.
    """
    if seizure_results is None:
        return None

    file_name = seizure_results.get("file")
    recording_id = Path(file_name).stem if file_name else None
    seizures = []

    for seizure in seizure_results.get("seizures", []):
        seizures.append({
            "start_seconds": seizure.get("start_time"),
            "end_seconds": seizure.get("end_time"),
            "duration_seconds": seizure.get("duration"),
            "mean_probability": seizure.get("mean_probability"),
            "max_probability": seizure.get("max_probability")
        })

    return {
        "recording_id": recording_id,
        "threshold": seizure_results.get("threshold"),
        "seizure_count": seizure_results.get("seizure_count", len(seizures)),
        "seizures": seizures
    }


def adapt_annotations(annotation_results):
    """
    Adapter for the EEG annotation output.
    """
    if annotation_results is None:
        return None

    recording = annotation_results.get("recording", {})
    file_name = recording.get("fileName")

    recording_id = Path(file_name).stem if file_name else None
    annotations = []

    for annotation in annotation_results.get("annotations", []):
        annotations.append({
            "start_seconds": annotation.get("startSec"),
            "end_seconds": annotation.get("endSec"),
            "channels": annotation.get("channels", []),
            "label": annotation.get("label"),
            "notes": annotation.get("notes")
        })

    return {
        "recording_id": recording_id,
        "annotations": annotations
    }


def combine_findings(
    background_results,
    seizure_results=None,
    annotation_results=None
):
    """
    Combine outputs from the three MCS18 EEG workstreams.
    """
    recording_id = background_results["recording_id"]

    seizure_results = adapt_seizure_results(seizure_results)
    annotation_results = adapt_annotations(annotation_results)

    # Prevent findings from different recordings being combined.
    if (
        seizure_results is not None
        and seizure_results["recording_id"] is not None
        and seizure_results["recording_id"] != recording_id
    ):
        raise ValueError(
            "Seizure results do not match the EEG recording: "
            f"{seizure_results['recording_id']} != {recording_id}"
        )

    if (
        annotation_results is not None
        and annotation_results["recording_id"] is not None
        and annotation_results["recording_id"] != recording_id
    ):
        raise ValueError(
            "Annotation results do not match the EEG recording: "
            f"{annotation_results['recording_id']} != {recording_id}"
        )

    combined = {
        "recording_id": recording_id,
        "background_analysis": background_results["background_analysis"]
    }

    if seizure_results is not None:
        combined["seizure_detection"] = seizure_results

    if annotation_results is not None:
        combined["annotations"] = annotation_results
        
    return combined


def run_pipeline(
    eeg_path,
    seizure_results=None,
    annotation_results=None,
    report_lang="English",
    output_root="pdf"
):
    """
    Run the complete MCS18 EEG analysis pipeline.
    Seizure-detection results and reviewer annotations are optional.
    """
    eeg_path = Path(eeg_path)

    # Load Gemini API key
    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY")

    if not api_key:
        raise ValueError("GOOGLE_API_KEY was not found in config.env")

    # Run Tung EEG analysis
    report = CreateReport(
        eeg_path.name,
        str(eeg_path.parent),
        LLM_API_KEY=api_key,
        llm_model="gemini-3.7-flash",
        model_folder=str(MODEL_DIR)
    )

    background_results = {
        "recording_id": eeg_path.stem,
        "background_analysis": report.finalResults
    }

    # Combine available workstreams
    combined = combine_findings(
        background_results,
        seizure_results=seizure_results,
        annotation_results=annotation_results
    )

    # Generate the combined AI report
    report_text = report.AI_Text_generate(
        reportLang=report_lang,
        seizure_detection=combined.get("seizure_detection"),
        annotations=combined.get("annotations")
    )

    output_folder = Path(output_root) / eeg_path.stem
    artifacts = report.generate_pdf(
        ai_report_text=report_text,
        dest_pdfPath=str(output_folder)
    )

    return {
        "recording_id": eeg_path.stem,
        "findings": combined,
        "report_text": report_text,
        "pdf_path": artifacts["pdf_path"],
        "graphs": artifacts["graphs"]
    }