# NeuroScope EEG Viewer

A browser-based, local-first EDF/EDF+ viewer and annotation tool. It is designed to support large files such as the Siena Scalp EEG Database recordings without loading the complete file into memory.

## Run

Start any static web server in this directory, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Choose a local `.edf` file. No EEG data is uploaded.

## Features

- Windowed EDF decoding, including per-signal sample rates and physical/digital scaling
- Multichannel canvas rendering suitable for dense 512 Hz EEG
- Time scrubber, next/previous navigation, playback, window zoom, and signal gain
- Channel filtering and visibility controls
- Drag-to-select regions
- Create, edit, delete, jump to, import, and export annotations
- Automatic annotation persistence in browser local storage, keyed to the source file
- Responsive clinical review interface

Mouse wheel navigates in time. Ctrl/Command + mouse wheel changes window size. Arrow keys navigate. Press `A` after selecting a region to annotate it.

## Annotation JSON schema

```json
{
  "schemaVersion": "1.0",
  "exportedAt": "2026-08-24T12:00:00.000Z",
  "recording": {
    "fileName": "PN03-1.edf",
    "fileSize": 1717986918,
    "lastModified": "2018-11-06T00:00:00.000Z",
    "durationSec": 14400,
    "startDate": "01.01.01",
    "startTime": "12.00.00"
  },
  "annotations": [
    {
      "id": "4bc3e540-9c52-4f93-a33c-5ec991cf5067",
      "startSec": 125.25,
      "endSec": 132.8,
      "label": "Seizure",
      "notes": "Rhythmic temporal onset with evolution.",
      "channels": ["EEG Fp1", "EEG F7"],
      "author": "",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "updatedAt": "2026-08-24T12:00:00.000Z"
    }
  ]
}
```

Time values are seconds from the beginning of the EDF recording. Imported JSON must contain an `annotations` array with this structure.

## Siena database notes

The Siena recordings use EDF, 512 Hz EEG, international 10–20 electrodes, and may include EKG channels. The viewer reads all numeric EDF signals, exposes their labels, and excludes EDF annotation metadata channels from the signal list. The dataset notes that its accompanying `Seizures-list-PNxx.txt` identifies which signals should be used; select those channels in the sidebar during review.

Because browser file access is intentionally local and permission-based, download the required EDF from PhysioNet first and then open it in the viewer.
