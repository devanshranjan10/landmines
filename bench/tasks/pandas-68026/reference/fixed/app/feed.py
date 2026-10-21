"""Catalog exports.

A catalog has the columns sku (str), title (str), price (float) and in_stock (bool). lxml isn't available
on the export hosts, so XML is written with the standard-library parser.
"""
import pandas as pd


def load_catalog(source) -> pd.DataFrame:
    """Read the catalog CSV (path or file-like object)."""
    return pd.read_csv(source, dtype={"sku": "str", "title": "str"})


def export_price_list(catalog: pd.DataFrame) -> str:
    """Price list XML for the in-store displays: <prices><item><sku/><price/></item>...</prices>."""
    return catalog[["sku", "price"]].to_xml(index=False, root_name="prices", row_name="item", parser="etree")


def export_feed(catalog: pd.DataFrame) -> str:
    """Catalog feed XML for the marketplace partner."""
    feed = catalog[["sku", "title", "price", "in_stock"]].copy()
    feed["in_stock"] = feed["in_stock"].map({True: "true", False: "false"})
    return feed.to_xml(index=False, root_name="products", row_name="product", parser="etree")
