"""Contact list export (CSV) and sync to the CRM."""
import csv
import io
import shutil
from dataclasses import dataclass
from pathlib import Path

import requests

FIELDS = ["name", "email", "city"]


@dataclass
class Contact:
    name: str
    email: str
    city: str = ""


def contacts_csv(contacts: list[Contact]) -> io.StringIO:
    """The contact list as CSV (header + one row per contact), rewound and ready to read."""
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(FIELDS)
    for c in contacts:
        writer.writerow([c.name, c.email, c.city])
    buf.seek(0)
    return buf


def export_to_file(contacts: list[Contact], path: str | Path) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        shutil.copyfileobj(contacts_csv(contacts), f)


def push_contacts(base_url: str, token: str, contacts: list[Contact]) -> int:
    raise NotImplementedError
