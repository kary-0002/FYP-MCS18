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


def format_seconds(seconds):
    if seconds is None:
        return "N/A"
    seconds = float(seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:05.2f}"


def format_background_section(background):
    lines = ["\n=== EEG Findings ==="]
    quality = background.get("EEG_quality")
    if quality:
        lines.append(f"- Technical quality: {quality}.")

    bad_channels = background.get("bad_channels") or []
    if bad_channels:
        lines.append(f"- Artifact-affected or flagged channels: {', '.join(bad_channels)}.")
    else:
        lines.append("- No channels were flagged by the automated artifact-detection process.")

    background_frequency = background.get("backgroundFrequency")
    if background_frequency:
        lines.append(f"- Estimated dominant background frequency: {background_frequency}.")

    background_activity = background.get("bg_active")
    if background_activity:
        lines.append(f"- Automated background activity assessment: {background_activity}.")

    amplitude = background.get("bg_amp")
    if amplitude:
        lines.append(f"- Estimated background alpha amplitude: {amplitude}.")

    amplitude_symmetry = background.get("bg_amp_sym")
    if amplitude_symmetry:
        lines.append(f"- Alpha amplitude symmetry: {amplitude_symmetry}.")

    frequency_symmetry = background.get("bg_freq")
    if frequency_symmetry:
        lines.append(f"- Background frequency symmetry: {frequency_symmetry}.")

    abnormalities = background.get("abnormalFindings") or []
    if abnormalities:
        lines.append("- Automated abnormal findings:")
        for finding in abnormalities:
            lines.append(f"  - {finding}")
    else:
        lines.append("- No abnormal findings were identified by the automated background-analysis pipeline.")
    return "\n".join(lines)


def format_seizure_section(seizure_detection):
    if seizure_detection is None:
        return None
    lines = ["=== Automated Seizure Detection ==="]
    seizures = seizure_detection.get("seizures") or []
    count = seizure_detection.get("seizure_count", len(seizures))
    threshold = seizure_detection.get("threshold")

    if count == 0:
        lines.append("- The automated detector returned no candidate seizure intervals.")
    else:
        lines.append(f"- The automated detector returned {count} candidate seizure interval{'s' if count != 1 else ''}.")
    if threshold is not None:
        lines.append(f"- Model decision threshold: {threshold}.")

    for index, seizure in enumerate(seizures, start=1):
        start = format_seconds(seizure.get("start_seconds"))
        end = format_seconds(seizure.get("end_seconds"))
        parts = [f"Candidate {index}: {start} - {end}"]

        duration = seizure.get("duration_seconds")
        if duration is not None:
            parts.append(f"duration: {float(duration):.2f} s")

        mean_probability = seizure.get("mean_probability")
        if mean_probability is not None:
            parts.append(f"mean model probability: {float(mean_probability):.3f}")

        max_probability = seizure.get("max_probability")
        if max_probability is not None:
            parts.append(f"maximum model probability: {float(max_probability):.3f}")
        lines.append(f"- {'; '.join(parts)}.")

    lines.append(
        "- These intervals are automated candidate detections and require "
        "clinical review; model probabilities do not represent diagnostic certainty."
    )
    return "\n".join(lines)


def format_annotation_section(annotation_results):
    if annotation_results is None:
        return None
    lines = ["=== Reviewer Annotations ==="]
    annotations = annotation_results.get("annotations") or []
    if not annotations:
        lines.append("- No reviewer annotations were supplied.")
        return "\n".join(lines)

    for index, annotation in enumerate(annotations, start=1):
        start = format_seconds(annotation.get("start_seconds"))
        end = format_seconds(annotation.get("end_seconds"))
        lines.append(f"- Annotation {index}: {start} - {end}.")

        channels = annotation.get("channels") or []
        if channels:
            lines.append(f"  Channels: {', '.join(channels)}.")

        label = annotation.get("label")
        if label:
            lines.append(f"  Reviewer-selected label: {label}.")

        notes = annotation.get("notes")
        if notes:
            lines.append(f"  Reviewer notes: {notes}")
    return "\n".join(lines)


def fallback_conclusion(combined):
    background = combined["background_analysis"]
    parts = []
    quality = background.get("EEG_quality")
    background_activity = background.get("bg_active")
    abnormalities = background.get("abnormalFindings") or []

    if quality:
        parts.append(f"The recording was assessed as having {quality.lower()} technical quality.")

    if background_activity:
        if background_activity.lower() == "normal background frequency":
            parts.append("Automated background analysis classfied the background frequency as normal.")
        else:
            parts.append(f"Automated background analysis identified {background_activity.lower()}.")

    if abnormalities:
        if background_activity and background_activity.lower() == "normal background frequency":
            parts.append("However, abnormal findings were identified in other assessed background features.")
        elif not background_activity:
            parts.append("The automated background-analysis pipeline identified abnormal findings.")

    seizure_detection = combined.get("seizure_detection")
    if seizure_detection is not None:
        count = seizure_detection.get("seizure_count", 0)
        if count:
            parts.append(
                f"The seizure-detection model identified {count} candidate "
                f"interval{'s' if count != 1 else ''} requiring clinical review."
            )
        else:
            parts.append("The seizure-detection model returned no candidate seizure intervals.")

    annotation_results = combined.get("annotations")
    annotation_count = 0
    if annotation_results is not None:
        annotation_count = len(annotation_results.get("annotations") or [])
        if annotation_count:
            parts.append(f"The recording contains {annotation_count} reviewer annotation{'s' if annotation_count != 1 else ''}.")

    parts.append("These findings should be interpreted in conjunction with")
    if annotation_count:
        parts.append("the EEG recording, reviewer annotations, and relevant clinical information.")
    else:
        parts.append("the EEG recording and relevant clinical information.")
    return f"=== Conclusion ===\n{' '.join(parts)}"


def build_report_text(combined, ai_report_text=None):
    sections = [format_background_section(combined["background_analysis"])]

    seizure_section = format_seizure_section(combined.get("seizure_detection"))
    if seizure_section:
        sections.append(seizure_section)

    annotation_section = format_annotation_section(combined.get("annotations"))
    if annotation_section:
        sections.append(annotation_section)

    ai_text = (ai_report_text or "").strip()
    sections.append(ai_text if ai_text else fallback_conclusion(combined))
    return "\n\n".join(sections)


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
    api_key = os.getenv("GOOGLE_API_KEY", "")

    # Run Tung EEG analysis
    report = CreateReport(
        eeg_path.name,
        str(eeg_path.parent),
        LLM_API_KEY=api_key,
        # llm_model="gemini-3.8-flash",
        llm_model="gemini-3.5-flash-lite",
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

    # Generate optional AI-assisted conclusion
    ai_report_text = ""
    if api_key:
        ai_report_text = report.AI_Text_generate(
            reportLang=report_lang,
            seizure_detection=combined.get("seizure_detection"),
            annotations=combined.get("annotations")
        )

    report_text = build_report_text(combined, ai_report_text)
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