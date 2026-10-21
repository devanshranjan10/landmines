"""Soil-moisture logger exports.

``readings`` is a 2-D uint8 array: one row per sample time, one column per sensor.
The logger writes 255 when a sensor did not report at that sample time.
"""
import numpy as np

NO_READING = 255


def valid_readings(readings):
    """Masked view of ``readings`` with the missing samples masked."""
    return np.ma.masked_equal(np.asarray(readings, dtype=np.uint8), NO_READING)


def sensor_means(readings):
    """Per-sensor mean of the valid samples (masked for sensors that never reported)."""
    return valid_readings(readings).mean(axis=0)


def sensor_minimums(readings):
    """Per-sensor minimum of the valid samples."""
    raise NotImplementedError
