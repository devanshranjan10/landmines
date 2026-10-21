"""Detector frame handling for the readout pipeline.

Frames are 2-D ``numpy.ma.MaskedArray`` objects of raw ADC counts (``uint16``);
dead or hot pixels are masked.
"""
import numpy as np

FRAME_DTYPE = np.uint16


def load_frame(counts, bad_pixels):
    """Wrap raw ``counts`` in a masked frame. ``bad_pixels`` is a boolean array of the same shape."""
    return np.ma.masked_array(
        np.asarray(counts, dtype=FRAME_DTYPE),
        mask=np.asarray(bad_pixels, dtype=bool),
    )


def frame_stats(frame):
    """(mean, max) over the valid pixels of ``frame``."""
    return float(frame.mean()), int(frame.max())


def add_pedestal(frame, pedestal):
    """Add the readout pedestal to every pixel of ``frame``, in place."""
    raise NotImplementedError
