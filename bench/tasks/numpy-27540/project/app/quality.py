"""Data-quality (DQ) plane for detector frames.

Every pixel has a uint32 bit field; each bit marks one condition.
"""
from enum import IntEnum

import numpy as np


class DQ(IntEnum):
    GOOD = 0
    SATURATED = 1
    DEAD = 2
    HOT = 4
    COSMIC_RAY = 8


def new_dq_plane(shape) -> np.ndarray:
    """All-GOOD DQ plane for a frame of the given shape."""
    return np.zeros(shape, dtype=np.uint32)


def has_flag(dq: np.ndarray, flag: DQ) -> np.ndarray:
    """Boolean mask of pixels that carry `flag`."""
    return (dq & flag) != 0


def flag_frame(image: np.ndarray, dq: np.ndarray, saturation: float) -> np.ndarray:
    """Add SATURATED / DEAD bits to `dq` for this frame (in place) and return it."""
    raise NotImplementedError
