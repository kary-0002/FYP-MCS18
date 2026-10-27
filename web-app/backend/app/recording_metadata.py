import pyedflib


def extract_recording_metadata(eeg_path):
    reader = pyedflib.EdfReader(str(eeg_path))

    try:
        header = reader.getHeader()
        sample_rates = [
            float(rate)
            for rate in reader.getSampleFrequencies()
        ]
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