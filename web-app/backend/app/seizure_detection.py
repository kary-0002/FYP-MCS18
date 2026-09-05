import numpy as np
import pyedflib
import torch

from scipy.signal import resample, butter, lfilter, iirnotch
from scipy.ndimage import binary_opening, binary_closing
from torch.utils.data import Dataset, DataLoader

from app.model import SeizureTransformer


TARGET_CHANNELS = [
    "fp1", "f3", "c3", "p3", "o1",
    "f7", "t3", "t5",
    "fz", "cz", "pz",
    "fp2", "f4", "c4", "p4", "o2",
    "f8", "t4", "t6"
]


def load_eeg(edf_path):
    # Load the EDF file
    reader = pyedflib.EdfReader(edf_path)

    signal_labels = reader.getSignalLabels()
    sample_rate = reader.getSampleFrequencies()[0]

    channel_indices = []

    # Find the required EEG channels
    for channel in TARGET_CHANNELS:
        matched_index = None

        for index, label in enumerate(signal_labels):
            normalized_label = label.lower().replace("eeg ", "").strip()

            if normalized_label == channel:
                matched_index = index
                break

        if matched_index is None:
            reader.close()

            raise ValueError(
                f"Required EEG channel not found: {channel}"
            )

        channel_indices.append(matched_index)

    n_samples = reader.getNSamples()[channel_indices[0]]

    eeg_data = np.zeros(
        (len(channel_indices), n_samples),
        dtype=np.float64
    )

    # Read the selected EEG channels
    for index, channel_index in enumerate(channel_indices):
        eeg_data[index] = reader.readSignal(channel_index)

    reader.close()

    return eeg_data, float(sample_rate)


class OfficialSeizureDataset(Dataset):
    def __init__(self, data, fs=256, window_size=15360):
        self.data = data
        self.fs = fs
        self.window_size = window_size

        # Define official preprocessing parameters
        self.lowcut = 0.5
        self.highcut = 120

        self.notch_1_b, self.notch_1_a = iirnotch(
            1, Q=30, fs=fs
        )

        self.notch_60_b, self.notch_60_a = iirnotch(
            60, Q=30, fs=fs
        )

    def __len__(self):
        if self.data.shape[1] < self.window_size:
            return 1

        return 1 + int(
            np.ceil(
                (self.data.shape[1] - self.window_size)
                / self.window_size
            )
        )

    def preprocess_clip(self, eeg_clip):
        # Apply band-pass filter
        nyquist = 0.5 * self.fs

        low = self.lowcut / nyquist
        high = self.highcut / nyquist

        b_band, a_band = butter(
            3,
            [low, high],
            btype="band"
        )

        eeg_clip = lfilter(
            b_band,
            a_band,
            eeg_clip,
            axis=1
        )

        # Apply notch filters
        eeg_clip = lfilter(
            self.notch_1_b,
            self.notch_1_a,
            eeg_clip,
            axis=1
        )

        eeg_clip = lfilter(
            self.notch_60_b,
            self.notch_60_a,
            eeg_clip,
            axis=1
        )

        return eeg_clip

    def __getitem__(self, idx):
        start = idx * self.window_size
        end = start + self.window_size

        eeg_clip = self.data[:, start:end]

        # Zero-pad the final window if needed
        if eeg_clip.shape[1] < self.window_size:
            padding = np.zeros(
                (
                    eeg_clip.shape[0],
                    self.window_size - eeg_clip.shape[1]
                ),
                dtype=eeg_clip.dtype
            )

            eeg_clip = np.concatenate(
                [eeg_clip, padding],
                axis=1
            )

        eeg_clip = self.preprocess_clip(eeg_clip)

        return torch.FloatTensor(eeg_clip)


def preprocess_eeg(eeg_data, sample_rate, target_fs=256):
    # Apply channel-wise z-score normalization
    mean = np.mean(
        eeg_data,
        axis=1,
        keepdims=True
    )

    std = np.std(
        eeg_data,
        axis=1,
        keepdims=True
    )

    std[std == 0] = 1

    eeg_data = (
        eeg_data - mean
    ) / std

    # Resample EEG to the model sampling rate
    if sample_rate != target_fs:
        new_n_samples = int(
            eeg_data.shape[1]
            * target_fs
            / sample_rate
        )

        eeg_data = resample(
            eeg_data,
            new_n_samples,
            axis=1
        )

    return eeg_data


def load_model(checkpoint_path, device=None):
    # Select device automatically if not provided
    if device is None:
        device = torch.device(
            "cuda" if torch.cuda.is_available() else "cpu"
        )

    # Load the pretrained checkpoint
    checkpoint = torch.load(
        checkpoint_path,
        map_location=device
    )

    model = SeizureTransformer(
        in_channels=19,
        in_samples=15360,
        dim_feedforward=2048,
        num_layers=8,
        num_heads=4
    ).to(device)

    model.load_state_dict(checkpoint)
    model.eval()

    return model, device


def remove_short_events(
    binary_signal,
    min_length=2.0,
    fs=256
):
    # Remove predicted seizure events shorter than the minimum duration
    min_samples = int(min_length * fs)
    output = binary_signal.copy()

    is_seizure = False
    start_idx = 0

    for i in range(len(output)):
        if not is_seizure and output[i] == 1:
            is_seizure = True
            start_idx = i

        elif is_seizure and (
            output[i] == 0
            or i == len(output) - 1
        ):
            end_idx = (
                i if output[i] == 0 else i + 1
            )

            if end_idx - start_idx < min_samples:
                output[start_idx:end_idx] = 0

            is_seizure = False

    return output


def prediction_to_intervals(
    prediction,
    threshold=0.8,
    fs=256
):
    # Convert seizure probabilities to a binary prediction
    binary_output = (
        prediction > threshold
    ).astype(int)

    # Apply official morphological post-processing
    structure = np.ones(
        5,
        dtype=bool
    )

    binary_output = binary_opening(
        binary_output,
        structure=structure
    ).astype(int)

    binary_output = binary_closing(
        binary_output,
        structure=structure
    ).astype(int)

    # Remove events shorter than 2 seconds
    binary_output = remove_short_events(
        binary_output,
        min_length=2.0,
        fs=fs
    )

    # Find seizure start and end indices
    changes = np.diff(
        np.concatenate(
            ([0], binary_output, [0])
        )
    )

    start_indices = np.where(
        changes == 1
    )[0]

    end_indices = np.where(
        changes == -1
    )[0]

    intervals = []

    for start_idx, end_idx in zip(
        start_indices,
        end_indices
    ):
        start_time = start_idx / fs
        end_time = end_idx / fs

        # Get probabilities within the detected seizure interval
        interval_probs = prediction[
            start_idx:end_idx
        ]

        intervals.append({
            "start_time": round(
                float(start_time),
                2
            ),
            "end_time": round(
                float(end_time),
                2
            ),
            "duration": round(
                float(end_time - start_time),
                2
            ),
            "mean_probability": round(
                float(np.mean(interval_probs)),
                4
            ),
            "max_probability": round(
                float(np.max(interval_probs)),
                4
            )
        })

    return intervals, binary_output

def detect_seizures(
    edf_path,
    checkpoint_path,
    threshold=0.8,
    batch_size=32
):
    # Load EEG from the EDF file
    eeg_data, sample_rate = load_eeg(
        edf_path
    )

    original_duration = (
        eeg_data.shape[1]
        / sample_rate
    )

    # Apply preprocessing
    eeg_data = preprocess_eeg(
        eeg_data,
        sample_rate,
        target_fs=256
    )

    # Prepare model input windows
    dataset = OfficialSeizureDataset(
        eeg_data,
        fs=256,
        window_size=15360
    )

    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False
    )

    # Load pretrained model
    model, device = load_model(
        checkpoint_path
    )

    predictions = []

    # Run inference
    with torch.no_grad():
        for batch in loader:
            batch = batch.float().to(device)

            output = model(batch)

            predictions.append(
                output.cpu().numpy()
            )

    # Convert window outputs to a continuous timeline
    prediction = np.concatenate(
        predictions,
        axis=0
    ).flatten()

    prediction = prediction[
        :eeg_data.shape[1]
    ]

    # Convert probabilities to seizure intervals
    intervals, binary_output = (
        prediction_to_intervals(
            prediction,
            threshold=threshold,
            fs=256
        )
    )

    # Return structured output for backend integration
    result = {
        "file": edf_path,
        "duration_seconds": round(
            float(original_duration),
            2
        ),
        "sampling_rate": 256,
        "threshold": threshold,
        "seizure_count": len(intervals),
        "seizures": intervals
    }

    return result