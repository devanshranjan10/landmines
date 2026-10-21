"""Keyword statistics for marketplace listing titles (search-suggestions dashboard)."""
from sklearn.feature_extraction.text import CountVectorizer


def normalize_title(title):
    """Collapse whitespace in a raw listing title."""
    return " ".join(str(title).split())


def term_counts(titles):
    """Total occurrences of each term across ``titles`` as ``{term: count}``."""
    raise NotImplementedError
