import os
import pyedflib
import numpy as np
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
from .auto_report import CreateReport

REPORTING_DIR = Path(__file__).resolve().parent
MODEL_DIR = REPORTING_DIR / "models"
HAND_DOMINANCE = {
    "L": "Left",
    "R": "Right",
    "U": "Unknown"
}


def calculate_relative_band_power(report):
    data, freqs = report.psds.get_data(return_freqs=True)
    # Average PSD across EEG channels.
    mean_psd = np.mean(data, axis=0)
    bands = {
        "delta": (1, 4),
        "theta": (4, 8),
        "alpha": (8, 13),
        "beta": (13, 30)
    }
    total_mask = (freqs >= 1) & (freqs <= 30)
    total_power = np.trapezoid(mean_psd[total_mask], freqs[total_mask])
    relative_power = {}
    for name, (low, high) in bands.items():
        mask = (freqs >= low) & (freqs < high)
        band_power = np.trapezoid(mean_psd[mask], freqs[mask])
        relative_power[name] = (float(band_power / total_power) if total_power > 0 else None)
    return relative_power


def build_background_analysis_payload(report):
    results = report.results
    summary = report.finalResults
    return {
        "summary": summary,
        "metrics": {
            "dominant_frequency_hz": {
                "left": float(results["left_backgroud_frequency"]),
                "right": float(results["right_backgroud_frequency"])
            },
            "relative_band_power": calculate_relative_band_power(report),
            "amplitude_uv": {
                "delta": float(results["amplitudes"]["delta"]),
                "theta": float(results["amplitudes"]["theta"]),
                "alpha": float(results["amplitudes"]["alpha"]),
                "beta": float(results["amplitudes"]["beta"])
            },
            "slow_wave_ratio_percent": {
                "left": float(results["left_slow_ratio"]),
                "right": float(results["right_slow_ratio"]),
                "total": float(results["total_slow_ratio"])
            },
            "beta_wave_ratio_percent": {
                "left": float(results["left_beta_ratio"]),
                "right": float(results["right_beta_ratio"]),
                "total": float(results["total_beta_ratio"])
            },
            "ap_gradient_percent": {
                "left": float(results["left_AP_difference"]),
                "right": float(results["right_AP_difference"]),
                "total": float(results["AP_difference"])
            },
            "left_right_asymmetry": {
                "delta": [float(value) for value in results["LR_delta_ratio"]],
                "theta": [float(value) for value in results["LR_theta_ratio"]],
                "alpha": [float(value) for value in results["LR_alpha_ratio"]]
            },
            "removed_epoch_percent": float(results["removeEpochsRatio"]),
            "bad_channels": list(results["bad_channels"]),
            "technical_quality": summary.get("EEG_quality")
        }
    }


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


def extract_recording_metadata(eeg_path):
    reader = pyedflib.EdfReader(str(eeg_path))
    try:
        header = reader.getHeader()
        sample_rates = [float(rate) for rate in reader.getSampleFrequencies()]
        unique_sample_rates = sorted(set(sample_rates))

        return {
            "patient_id": header.get("patientcode") or None,
            "recording_start": reader.getStartdatetime(),
            "duration_seconds": float(reader.file_duration),
            "sampling_rate_hz": (
                unique_sample_rates[0]
                if len(unique_sample_rates) == 1
                else None
            ),
            "channel_count": int(reader.signals_in_file),
        }
    finally:
        reader.close()


def format_seconds(seconds):
    if seconds is None:
        return "N/A"
    seconds = float(seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:05.2f}"


def format_nicolet_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).strftime("%d %b %Y")
    except (TypeError, ValueError):
        return str(value)


def format_nicolet_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).strftime("%d %b %Y, %H:%M:%S")
    except (TypeError, ValueError):
        return str(value)


def format_patient_information(metadata):
    nicolet = metadata.get("nicolet")
    if not nicolet:
        return None
    patient = nicolet.get("patient", {})
    lines = ["=== Patient Information ==="]
    name_parts = [
        patient.get("firstName"),
        patient.get("middleName"),
        patient.get("lastName"),
    ]
    name = " ".join(
        part.strip()
        for part in name_parts
        if isinstance(part, str) and part.strip()
    )

    if name:
        lines.append(f"- Patient name: {name}.")
    patient_id = patient.get("altID")
    if patient_id:
        lines.append(f"- Patient ID: {patient_id}.")
    edf_patient_id = metadata.get("patient_id")
    if edf_patient_id:
        lines.append(f"- EDF Patient ID: {edf_patient_id}.")
    dob = format_nicolet_date(patient.get("DOB"))
    if dob:
        lines.append(f"- Date of birth: {dob}.")
    dominance = patient.get("dominance")
    if dominance:
        dominance = HAND_DOMINANCE.get(str(dominance).upper(), dominance)
        lines.append(f"- Hand dominance: {dominance}.")
    notes = patient.get("notes")
    if notes:
        lines.append(f"- Patient notes: {notes}.")
    return "\n".join(lines) if len(lines) > 1 else None


def format_test_information(metadata):
    nicolet = metadata.get("nicolet")
    if not nicolet:
        return None
    study = nicolet.get("study", {}).get("mapped", {})
    test = nicolet.get("test", {}).get("mapped", {})
    lines = ["=== Test Information ==="]
    fields = [
        ("Test ID", study.get("test_id")),
        ("Type", study.get("type")),
        ("Requested by", study.get("requested_by")),
        ("Technologist", test.get("technologist")),
        ("Patient state", study.get("patient_state")),
        ("Creation date", format_nicolet_datetime(study.get("creation_date"))),
        ("Recording site", test.get("recording_site")),
    ]
    for label, value in fields:
        if value not in (None, ""):
            lines.append(f"- {label}: {value}.")
    return "\n".join(lines) if len(lines) > 1 else None


def format_recording_metadata(metadata):
    lines = ["=== Recording Information ==="]
    if not metadata.get("nicolet"):
        patient_id = metadata.get("patient_id")
        if patient_id:
            lines.append(f"- Patient ID: {patient_id}.")

    recording_start = metadata.get("recording_start")
    if recording_start:
        lines.append(f"- Recording start: {recording_start.strftime('%d %b %Y, %H:%M:%S')}.")

    duration = metadata.get("duration_seconds")
    if duration is not None:
        total_seconds = int(round(duration))
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        lines.append(f"- Recording duration: {hours:02d}:{minutes:02d}:{seconds:02d}.")

    sampling_rate = metadata.get("sampling_rate_hz")
    if sampling_rate is not None:
        lines.append(f"- Sampling rate: {sampling_rate:g} Hz.")

    channel_count = metadata.get("channel_count")
    if channel_count is not None:
        lines.append(f"- Recorded channels: {channel_count}.")
    return "\n".join(lines)


def format_background_section(background):
    lines = ["=== EEG Findings ==="]
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

    lines.append("- These intervals are automated candidate detections and require clinical review.")
    lines.append("- Model probabilities do not represent diagnostic certainty.")
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
        lines.append(f"- Annotation {index} — {start} - {end}")

        channels = annotation.get("channels") or []
        if channels:
            lines.append(f"  Channels: {', '.join(channels)}")
        else:
            lines.append("  Channels: All visible channels")

        label = annotation.get("label")
        if label:
            lines.append(f"  Reviewer-selected label: {label}")

        notes = annotation.get("notes")
        if notes:
            lines.append(f"  Reviewer notes: {notes}")
    return "\n".join(lines)


def fallback_conclusion(combined):
    background = combined["background_analysis"]
    impression = []
    quality = background.get("EEG_quality")
    background_activity = background.get("bg_active")
    abnormalities = background.get("abnormalFindings") or []
    bad_channels = background.get("bad_channels") or []

    if quality:
        impression.append(f"The recording was assessed as having {quality.lower()} technical quality.")

    if background_activity:
        if background_activity.lower() == "normal background frequency":
            impression.append("Automated background analysis classified the background frequency as normal.")
        else:
            impression.append(f"Automated background analysis identified {background_activity.lower()}.")

    if abnormalities:
        impression.append("Additional abnormal findings were identified by the automated background-analysis pipeline.")

    seizure_detection = combined.get("seizure_detection")
    seizure_count = 0
    if seizure_detection is not None:
        seizure_count = seizure_detection.get("seizure_count", 0)
        if seizure_count:
            impression.append(
                f"The automated seizure-detection model identified {seizure_count} candidate "
                f"interval{'s' if seizure_count != 1 else ''} requiring clinical review."
            )
        else:
            impression.append("The automated seizure-detection model returned no candidate seizure intervals.")

    annotation_results = combined.get("annotations")
    annotation_count = 0
    if annotation_results is not None:
        annotation_count = len(annotation_results.get("annotations") or [])
        if annotation_count:
            impression.append(f"The recording contains {annotation_count} reviewer annotation{'s' if annotation_count != 1 else ''}.")

    impression.append("These findings require clinical review and correlation with the EEG recording and relevant clinical information.")

    next_steps = []
    if seizure_count:
        next_steps.append("Review the automated seizure candidate intervals against the EEG recording.")
    if annotation_count:
        next_steps.append("Review the reviewer annotations together with the automated findings.")
    if bad_channels or (quality and quality.lower() != "good"):
        next_steps.append("Consider the identified technical limitations and flagged channels when interpreting the recording.")

    next_steps.append("Correlate the automated findings with relevant clinical information and consider further review or investigation if clinically indicated.")

    return "=== Impression ===\n" + " ".join(impression) + "\n\n=== Suggested Next Steps ===\n" + "\n".join(f"- {item}" for item in next_steps)


def build_report_text(combined, ai_report_text=None, seizure_detection_status="completed"):
    # recording_metadata = combined["recording_metadata"]
    sections = [
        # format_patient_information(recording_metadata),
        # format_test_information(recording_metadata),
        # format_recording_metadata(recording_metadata),
        format_background_section(combined["background_analysis"])
    ]
    # sections = [section for section in sections if section]

    if seizure_detection_status == "failed":
        sections.append(
            "=== Automated Seizure Detection ===\n"
            "- Automated seizure detection could not be completed for this recording."
        )
    else:
        seizure_section = format_seizure_section(combined.get("seizure_detection"))
        if seizure_section:
            sections.append(seizure_section)

    annotation_section = format_annotation_section(combined.get("annotations"))
    if annotation_section:
        sections.append(annotation_section)

    ai_text = (ai_report_text or "").strip()
    sections.append(ai_text if ai_text else fallback_conclusion(combined))
    return "\n\n".join(sections)


def prepare_analysis(eeg_path, nicolet_metadata=None, progress_callback=None):
    eeg_path = Path(eeg_path)
    recording_metadata = extract_recording_metadata(eeg_path)
    if nicolet_metadata is not None:
        recording_metadata["nicolet"] = nicolet_metadata
    report = CreateReport(
        eeg_path.name,
        str(eeg_path.parent),
        model_folder=str(MODEL_DIR),
        progress_callback=progress_callback,
    )
    return {
        "report": report,
        "recording_metadata": recording_metadata,
        "background_analysis": build_background_analysis_payload(report)
    }


def generate_report_from_analysis(
    report,
    eeg_path,
    recording_metadata,
    seizure_results=None,
    annotation_results=None,
    seizure_detection_status="completed",
    report_lang="English",
    output_root="pdf",
    progress_callback=None
):
    def report_progress(percent, message):
        if progress_callback:
            progress_callback(percent, message)

    report_progress(5, "Combining EEG findings, detections, and annotations")
    eeg_path = Path(eeg_path)
    background_results = {
        "recording_id": eeg_path.stem,
        "background_analysis": report.finalResults
    }
    combined = combine_findings(
        background_results,
        seizure_results=seizure_results,
        annotation_results=annotation_results
    )
    combined["recording_metadata"] = recording_metadata

    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY", "")
    report.LLM_API_KEY = api_key
    report.llm_model = "gemini-3.5-flash-lite"
    # report.llm_model = "gemini-3.8-flash"

    ai_report_text = ""
    if api_key:
        report_progress(20, "Drafting report text with the configured AI service")
        ai_report_text = report.AI_Text_generate(
            reportLang=report_lang,
            seizure_detection=combined.get("seizure_detection"),
            annotations=combined.get("annotations")
        )
    else:
        report_progress(20, "Preparing report text from EEG findings")

    report_progress(55, "Building report sections and clinical summary")
    report_text = build_report_text(
        combined,
        ai_report_text,
        seizure_detection_status
    )
    output_folder = Path(output_root) / eeg_path.stem
    report_progress(70, "Creating PDF pages and EEG figures")
    artifacts = report.generate_pdf(
        ai_report_text=report_text,
        report_data=combined,
        dest_pdfPath=str(output_folder)
    )
    report_progress(95, "Finalizing generated PDF")

    return {
        "recording_id": eeg_path.stem,
        "findings": combined,
        "report_text": report_text,
        "pdf_path": artifacts["pdf_path"],
        "graphs": artifacts["graphs"]
    }


def run_pipeline(
    eeg_path,
    seizure_results=None,
    annotation_results=None,
    seizure_detection_status="completed",
    report_lang="English",
    output_root="pdf",
    nicolet_metadata=None
):
    eeg_path = Path(eeg_path)
    analysis = prepare_analysis(
        eeg_path,
        nicolet_metadata=nicolet_metadata
    )
    return generate_report_from_analysis(
        report=analysis["report"],
        eeg_path=eeg_path,
        recording_metadata=analysis["recording_metadata"],
        seizure_results=seizure_results,
        annotation_results=annotation_results,
        seizure_detection_status=seizure_detection_status,
        report_lang=report_lang,
        output_root=output_root
    )
