"""Plots for the attention study report.

``df`` has one row per subject: ``subject`` (int), ``score`` (float), ``solutions`` (int, puzzles solved)
and ``attention`` ("divided" or "focused").
"""
import matplotlib.pyplot as plt
import seaborn as sns

AREA_PER_SOLUTION = 20  # marker area in points^2 per solved puzzle (same scale as the printed report)


def _axes(ax):
    if ax is None:
        _, ax = plt.subplots(figsize=(8, 4))
    return ax


def plot_score_hist(df, ax=None):
    """Histogram of scores per attention condition."""
    ax = _axes(ax)
    sns.histplot(data=df, x="score", hue="attention", ax=ax)
    return ax


def plot_scores(df, ax=None):
    """Score per subject; marker area shows the number of solved puzzles."""
    ax = _axes(ax)
    sns.scatterplot(
        data=df, x="subject", y="score", hue="attention",
        s=df["solutions"] * AREA_PER_SOLUTION, ax=ax,
    )
    return ax
