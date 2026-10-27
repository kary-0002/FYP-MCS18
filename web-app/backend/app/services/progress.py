from app.state import ANALYSIS_PROGRESS


def begin_analysis_progress(session_id: str, task: str):
    ANALYSIS_PROGRESS[(session_id, task)] = {
        "status": "running",
        "percent": None,
        "message": "Starting",
        "events": [],
        "next_event_id": 1,
    }

    return lambda percent, message: update_analysis_progress(
        session_id,
        task,
        percent,
        message,
    )


def update_analysis_progress(
    session_id: str,
    task: str,
    percent,
    message: str,
    status="running",
):
    progress = ANALYSIS_PROGRESS.setdefault(
        (session_id, task),
        {
            "status": status,
            "percent": None,
            "message": "Starting",
            "events": [],
            "next_event_id": 1,
        },
    )

    percent = max(0, min(100, int(percent))) if percent is not None else None

    progress.update(
        {
            "status": status,
            "percent": percent,
            "message": message,
        }
    )

    events = progress["events"]

    if not events or events[-1]["message"] != message:
        event_id = progress["next_event_id"]
        progress["next_event_id"] += 1

        events.append(
            {
                "id": event_id,
                "message": message,
                "percent": percent,
                "status": status,
            }
        )

        del events[:-100]