"""Sensor readings and the JSON batch format shared with the analytics service.

A batch is a JSON array of reading objects. Sensors report NaN for a failed sample and +/-Infinity when
the value is out of range; the analytics service relies on seeing those as the JSON constants NaN / Infinity
/ -Infinity (never null), so they must survive the round trip.
"""
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer, TypeAdapter

# Values are stored at full precision but published rounded to 3 decimals.
Rounded = Annotated[float, PlainSerializer(lambda v: round(v, 3))]


class Reading(BaseModel):
    model_config = ConfigDict(ser_json_inf_nan="constants")

    sensor_id: str
    taken_at: datetime
    value: Rounded


_BATCH = TypeAdapter(list[Reading])


def load_batch(raw: bytes | str) -> list[Reading]:
    """Parse a JSON batch received from the gateway."""
    return _BATCH.validate_json(raw)


def export_batch(readings: list[Reading]) -> bytes:
    """Serialize readings into a JSON batch for the analytics service."""
    return _BATCH.dump_json(readings)
