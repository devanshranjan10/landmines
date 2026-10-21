"""Reminder times for the chat bot. All times are handled in UTC."""
import re

import arrow


def describe(when: str, now: str) -> str:
    """Human description shown in the reminder list, e.g. 'in 3 hours' or '2 days ago'."""
    return arrow.get(when).humanize(arrow.get(now))


def parse_relative(text: str, now: str) -> arrow.Arrow:
    """Turn a relative time typed by a user into an absolute time."""
    m = _RELATIVE.fullmatch(text.strip().lower())
    if not m or bool(m.group("future")) == bool(m.group("past")):
        raise ValueError(f"not a relative time: {text!r}")
    amount = 1.0 if m.group("amount") in ("a", "an") else float(m.group("amount"))
    if m.group("past"):
        amount = -amount
    return arrow.get(now).to("UTC").shift(**{m.group("unit") + "s": amount})


_RELATIVE = re.compile(
    r"(?P<future>in\s+)?(?P<amount>\d+(?:\.\d+)?|an?)\s+(?P<unit>minute|hour|day|week)s?(?P<past>\s+ago)?"
)
