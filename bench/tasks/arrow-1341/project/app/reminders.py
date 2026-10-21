"""Reminder times for the chat bot. All times are handled in UTC."""
import arrow


def describe(when: str, now: str) -> str:
    """Human description shown in the reminder list, e.g. 'in 3 hours' or '2 days ago'."""
    return arrow.get(when).humanize(arrow.get(now))


def parse_relative(text: str, now: str) -> arrow.Arrow:
    """Turn a relative time typed by a user into an absolute time."""
    raise NotImplementedError
