"""Brand colors for dashboard charts."""
import plotly.graph_objects as go
from plotly import colors

# Continuous brand ramp, navy -> amber. Used for heatmaps and for categorical series.
BRAND_SCALE = [[0.0, "#0b3d91"], [1.0, "#f2a900"]]

# Fixed colors for status badges.
STATUS_COLORS = {"ok": colors.qualitative.Safe[3], "warn": colors.qualitative.Safe[1], "error": colors.qualitative.Safe[9]}


def category_colors(categories: list[str]) -> dict[str, str]:
    """Map each category to a color taken from BRAND_SCALE."""
    if not categories:
        return {}
    n = len(categories)
    points = [i / (n - 1) for i in range(n)] if n > 1 else [0.0]
    sampled = colors.sample_colorscale(BRAND_SCALE, points)
    return dict(zip(categories, sampled))


def heatmap(z: list[list[float]]) -> go.Figure:
    return go.Figure(go.Heatmap(z=z, colorscale=BRAND_SCALE))


def bar_chart(totals: dict[str, float]) -> go.Figure:
    """Bar chart with one bar per category, colored with category_colors()."""
    cmap = category_colors(list(totals))
    return go.Figure(go.Bar(x=list(totals), y=list(totals.values()), marker_color=[cmap[c] for c in totals]))
