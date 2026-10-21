"""The editable price sheet behind the storefront.

The sheet is a pandas DataFrame with one row per SKU (columns ``sku``, ``price``, ``stock``) that merchandising edits
in place. Published versions are pyarrow Tables; the storefront and the audit log read those.
"""
from __future__ import annotations

import pandas as pd
import pyarrow as pa

COLUMNS = ["sku", "price", "stock"]


class PriceSheet:
    def __init__(self, rows: list[dict]):
        self.df = pd.DataFrame(rows, columns=COLUMNS).astype({"price": "float64", "stock": "int64"})
        self.published: list[pa.Table] = []

    def _row(self, sku: str):
        mask = self.df["sku"] == sku
        if not mask.any():
            raise KeyError(sku)
        return mask

    def set_price(self, sku: str, price: float) -> None:
        self.df.loc[self._row(sku), "price"] = float(price)

    def set_stock(self, sku: str, stock: int) -> None:
        self.df.loc[self._row(sku), "stock"] = int(stock)

    def restock(self, sku: str, qty: int) -> None:
        mask = self._row(sku)
        self.df.loc[mask, "stock"] = self.df.loc[mask, "stock"] + int(qty)

    def apply_discount(self, pct: float) -> None:
        """Discount every SKU by ``pct`` percent."""
        self.df["price"] = (self.df["price"] * (1 - pct / 100)).round(2)

    def latest(self) -> pa.Table | None:
        return self.published[-1] if self.published else None

    def publish(self) -> pa.Table:
        """Snapshot the sheet as a pyarrow Table (sku, price, stock), record it in ``published`` and return it."""
        raise NotImplementedError
