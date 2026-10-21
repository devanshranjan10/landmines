"""Chart theming for customer dashboards."""
import plotly.colors as pc

DEFAULT_PALETTE = list(pc.qualitative.Plotly)


def validate_palette(colors):
    """Check a user-supplied list of series colors."""
    for color in colors:
        try:
            pc.validate_colors(color)
        except Exception as exc:
            raise ValueError(f"invalid palette color: {color!r}") from exc
    return list(colors)


def palette_for(config):
    """Series colors for a dashboard config dict, falling back to DEFAULT_PALETTE."""
    colors = config.get("palette")
    return list(DEFAULT_PALETTE) if not colors else validate_palette(colors)


def apply_palette(fig, colors):
    """Use ``colors`` as the series colorway of a plotly figure."""
    fig.update_layout(colorway=list(colors))
    return fig
