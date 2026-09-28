import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from nicolet_e2edf.nicolet.header import (
    _lookup_static,
    _main_index_by_section,
    read_nervus_header
)

OLE_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)

STUDY_PROPERTY_NAMES = {
    3: "type",
    13: "test_id",
    21: "patient_state",
    22: "requested_by",
    23: "creation_date"
}

TEST_PROPERTY_NAMES = {
    17: "recording_site"
}


def _serialise_value(value: Any):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _decode_ole_date(value: float) -> str:
    return (OLE_EPOCH + timedelta(days=value)).isoformat()


def _read_property_section(e_file: Path, header, section_name: str) -> dict[int, Any]:
    packet = _lookup_static(header.StaticPackets, idstr=section_name)
    if packet is None:
        return {}

    entries = _main_index_by_section(header.MainIndex, packet.index)
    if not entries:
        return {}

    entry = entries[0]
    with e_file.open("rb") as handle:
        handle.seek(entry.offset)
        handle.read(16) # section GUID
        handle.read(8)  # Section length

        n_values = int.from_bytes(handle.read(8), byteorder="little")
        n_bstr = int.from_bytes(handle.read(8), byteorder="little")
        properties: dict[int, Any] = {}

        # Numeric properties
        for _ in range(n_values):
            prop_id = int.from_bytes(handle.read(8), byteorder="little")
            raw_value = handle.read(8)
            double_value = struct.unpack("<d", raw_value)[0]
            properties[prop_id] = double_value

        # String property ID / length table
        string_setup = []
        for _ in range(n_bstr):
            prop_id = int.from_bytes(handle.read(8), byteorder="little")
            string_length = int.from_bytes(handle.read(8), byteorder="little")
            string_setup.append((prop_id, string_length))

        # String data
        for prop_id, string_length in string_setup:
            raw = handle.read((string_length + 1) * 2)
            value = raw.decode("utf-16le", errors="replace").rstrip("\x00")
            properties[prop_id] = value
    return properties


def _map_properties(properties: dict[int, Any], names: dict[int, str]) -> dict[str, Any]:
    mapped = {}
    for prop_id, name in names.items():
        if prop_id in properties:
            mapped[name] = properties[prop_id]
    return mapped


def extract_nicolet_metadata(e_file: str | Path) -> dict[str, Any]:
    e_file = Path(e_file)
    _, header = read_nervus_header(str(e_file))
    patient_info = {
        key: _serialise_value(value)
        for key, value in (header.PatientInfo or {}).items()
    }

    study_raw = _read_property_section(e_file, header, "STUDYINFOGUID")
    test_raw = _read_property_section(e_file, header, "TESTINFOGUID")
    users_raw = _read_property_section(e_file, header, "USERSINFOGUID")

    study_mapped = _map_properties(study_raw, STUDY_PROPERTY_NAMES)
    test_mapped = _map_properties(test_raw, TEST_PROPERTY_NAMES)

    # Property 23 appears to be an OLE datetime.
    if 23 in study_raw:
        study_mapped["creation_date"] = _decode_ole_date(float(study_raw[23]))

    # Current USERSINFOGUID structure:
    #   property 1 = user GUID
    #   property 2 = user/display name
    users = {}

    user_id = users_raw.get(1)
    user_name = users_raw.get(2)
    if user_id is not None:
        users[str(user_id)] = user_name

    # Resolve the technologist reference where possible.
    technologist_id = test_raw.get(4)
    if technologist_id is not None:
        test_mapped["technologist"] = users.get(
            str(technologist_id)
        )

    return {
        "patient": patient_info,
        "study": {
            "mapped": study_mapped,
            "raw_properties": study_raw,
        },
        "test": {
            "mapped": test_mapped,
            "raw_properties": test_raw,
        },
        "users": {
            "resolved": users,
            "raw_properties": users_raw,
        }
    }