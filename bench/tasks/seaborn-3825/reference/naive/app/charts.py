"""Charts for the cohort retention report.

``df`` has one row per user and week: columns ``cohort`` (str), ``week`` (int) and ``retention`` (float, 0-1).
"""
import matplotlib.pyplot as plt
import seaborn as sns


def _axes(ax):
    if ax is None:
        _, ax = plt.subplots(figsize=(8, 4))
    return ax


def plot_activity(df, ax=None):
    """Number of retention samples per week and cohort."""
    ax = _axes(ax)
    sns.countplot(data=df, x="week", hue="cohort", ax=ax)
    return ax


def plot_retention(df, ax=None):
    """Mean retention per week, one series per cohort."""
    ax = _axes(ax)
    sns.pointplot(data=df, x="week", y="retention", hue="cohort", dodge=True, ax=ax)
    return ax
