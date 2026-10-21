"""Candidate survey responses exported from the careers form.

Export columns: respondent, team, seniority, work_modes. Every answer comes from the form's fixed option
lists, so answer columns are stored as categoricals (exports run to hundreds of thousands of rows).
Multiple-choice answers are the chosen options joined with " | ".
"""
import pandas as pd

ANSWER_COLUMNS = ["team", "seniority", "work_modes"]


def load_responses(source) -> pd.DataFrame:
    """Read a survey export CSV (path or file-like object)."""
    df = pd.read_csv(source)
    return df.astype({col: "category" for col in ANSWER_COLUMNS})


def team_counts(responses: pd.DataFrame) -> dict[str, int]:
    """Number of respondents per team (teams nobody picked are left out)."""
    counts = responses["team"].value_counts()
    return {team: int(n) for team, n in counts.items() if n}


def seniority_share(responses: pd.DataFrame) -> dict[str, float]:
    """Fraction of respondents per seniority level."""
    return {level: float(x) for level, x in responses["seniority"].value_counts(normalize=True).items() if x}


def work_mode_matrix(responses: pd.DataFrame) -> pd.DataFrame:
    """One 0/1 column per work mode."""
    return responses["work_modes"].str.get_dummies(sep=" | ")


def work_mode_share(responses: pd.DataFrame) -> dict[str, float]:
    """Fraction of respondents who selected each work mode."""
    return {mode: float(x) for mode, x in work_mode_matrix(responses).mean().items()}
