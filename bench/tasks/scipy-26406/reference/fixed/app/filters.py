"""Low-pass filtering for the vibration sensor feed.

Recordings are 1-D float arrays sampled at ``FS`` Hz. We low-pass them with a Butterworth filter
before feature extraction.
"""
import numpy as np
from scipy.signal import butter, lfilter

FS = 1000.0  # Hz
CUTOFF_HZ = 50.0
ORDER = 4


def design(cutoff_hz=CUTOFF_HZ, fs=FS, order=ORDER):
    """Butterworth low-pass coefficients ``(b, a)``."""
    return butter(order, cutoff_hz, fs=fs)


def filter_recording(x, cutoff_hz=CUTOFF_HZ, fs=FS):
    """Low-pass a complete recording (filter starts from rest)."""
    b, a = design(cutoff_hz, fs)
    return lfilter(b, a, np.asarray(x, dtype=float))


class StreamFilter:
    """Low-pass filter for the live feed, fed one chunk at a time."""

    def __init__(self, cutoff_hz=CUTOFF_HZ, fs=FS):
        self.b, self.a = design(cutoff_hz, fs)
        self.zi = np.zeros(max(len(self.a), len(self.b)) - 1)

    def process(self, chunk):
        """Filter the next chunk of the stream and return the filtered samples for it."""
        chunk = np.asarray(chunk, dtype=float)
        if chunk.size == 0:
            return chunk.copy()
        y, self.zi = lfilter(self.b, self.a, chunk, zi=self.zi)
        return y
