# Hidden test for pydantic-10570. Run from the task's working directory.
import json
import os
import sys

sys.path.insert(0, os.getcwd())
from app.catalog import Currency, Listing, PriceTier, effective_settlement_currency, listing_feed  # noqa: E402

fail = 0
total = 0


def check(name, fn):
    global fail, total
    total += 1
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"raised {type(e).__name__}: {e}"
    if not ok:
        fail += 1
        print(f"FAIL {name}: {detail}")


def tiers():
    return [
        PriceTier(min_qty=1, unit_price_cents=1200, currency="USD"),
        PriceTier(min_qty=100, unit_price_cents=950, currency="USD", settlement_currency="EUR"),
        PriceTier(min_qty=1000, unit_price_cents=800, currency=Currency.GBP, settlement_currency=Currency.JPY),
    ]


def t_effective():
    got = [effective_settlement_currency(t) for t in tiers()]
    ok = got == ["USD", "EUR", "JPY"] and all(type(g) is str for g in got)
    return ok, f"got {got!r}, want ['USD', 'EUR', 'JPY'] as str"


def t_feed_tiers():
    feed = json.loads(listing_feed([Listing(sku="MUG-1", title="Mug", tiers=tiers(), currency="USD")]))
    got = [t.get("settlement_currency", "<missing>") for t in feed[0]["tiers"]]
    return got == [None, "EUR", "JPY"], f"tier settlement_currency in feed = {got!r}"


def t_feed_listing_currency():
    feed = json.loads(listing_feed([
        Listing(sku="MUG-1", title="Mug", tiers=tiers(), currency="USD"),
        Listing(sku="CAP-2", title="Cap", tiers=[], currency=Currency.EUR),
    ]))
    got = [(row["sku"], row["currency"]) for row in feed]
    return got == [("MUG-1", "USD"), ("CAP-2", "EUR")], f"got {got!r}"


def t_feed_full_row():
    feed = json.loads(listing_feed([Listing(sku="CAP-2", title="Cap", tiers=[PriceTier(min_qty=1, unit_price_cents=500, currency="EUR")], currency="EUR")]))
    want = [{"sku": "CAP-2", "title": "Cap", "tiers": [{"min_qty": 1, "unit_price_cents": 500, "currency": "EUR", "settlement_currency": None}], "currency": "EUR"}]
    return feed == want, f"got {feed!r}"


def t_empty_feed():
    return json.loads(listing_feed([])) == [], "empty feed is not []"


check("effective_settlement_currency", t_effective)
check("feed includes settlement_currency", t_feed_tiers)
check("feed listing currency", t_feed_listing_currency)
check("feed full row", t_feed_full_row)
check("empty feed", t_empty_feed)
print(f"FAILED {fail}/{total}" if fail else f"PASSED {total}/{total}")
sys.exit(1 if fail else 0)
