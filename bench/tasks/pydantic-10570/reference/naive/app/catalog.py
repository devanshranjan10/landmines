"""Product catalog models and the storefront feed."""
import json
from enum import Enum

from pydantic import BaseModel, ConfigDict


class Currency(Enum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    JPY = "JPY"


class AppModel(BaseModel):
    # Enum fields are stored as their plain values so models dump straight to JSON.
    model_config = ConfigDict(use_enum_values=True)


class PriceTier(AppModel):
    """Volume price: from `min_qty` units on, one unit costs `unit_price_cents` in `currency`."""

    min_qty: int
    unit_price_cents: int
    currency: Currency
    settlement_currency: Currency | None = None  # None: settled in `currency`


class Listing(AppModel):
    sku: str
    title: str
    tiers: list[PriceTier]
    currency: Currency  # currency the listing is displayed in


def listing_feed(listings: list[Listing]) -> str:
    """JSON feed consumed by the storefront."""
    return json.dumps([listing.model_dump() for listing in listings])


def effective_settlement_currency(tier: PriceTier) -> str:
    """Currency code the tier is settled in, e.g. "EUR"."""
    return tier.settlement_currency or tier.currency
