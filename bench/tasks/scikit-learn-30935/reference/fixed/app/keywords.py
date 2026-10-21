"""Keyword statistics for marketplace listing titles (search-suggestions dashboard)."""
from sklearn.feature_extraction.text import CountVectorizer


def normalize_title(title):
    """Collapse whitespace in a raw listing title."""
    return " ".join(str(title).split())


def term_counts(titles):
    """Total occurrences of each term across ``titles`` as ``{term: count}``."""
    # The default token_pattern (\w\w+) splits Indic words at combining vowel signs/viramas,
    # so tokenize on whitespace instead.
    vectorizer = CountVectorizer(token_pattern=r"(?u)\S+")
    matrix = vectorizer.fit_transform(normalize_title(t) for t in titles)
    totals = matrix.sum(axis=0).A1
    return {str(term): int(n) for term, n in zip(vectorizer.get_feature_names_out(), totals)}
