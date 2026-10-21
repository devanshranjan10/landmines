"""Transit network: stations are nodes, each line segment between two stations is an edge.

Several lines can serve the same pair of stations, so networks are undirected MultiGraphs with one
edge per (station, station, line) and the line name stored in the edge attribute "line".
"""
import networkx as nx
from networkx.algorithms import isomorphism


def build_network(segments: list[tuple[str, str, str]]) -> nx.MultiGraph:
    """segments: (station_a, station_b, line)."""
    g = nx.MultiGraph()
    for a, b, line in segments:
        g.add_edge(a, b, line=line)
    return g


def lines_between(network: nx.MultiGraph, a: str, b: str) -> set[str]:
    return {d["line"] for d in network.get_edge_data(a, b, default={}).values()}


def same_layout(a: nx.MultiGraph, b: nx.MultiGraph) -> bool:
    """True if the two networks are the same up to station names (used to dedupe imported timetables)."""
    return nx.is_isomorphic(a, b, edge_match=isomorphism.categorical_multiedge_match("line", None))


def _serves_pattern_lines(network_edges: dict, pattern_edges: dict) -> bool:
    # Every line the pattern needs between two stations must run there; extra lines are fine.
    return {d.get("line") for d in network_edges.values()} >= {d.get("line") for d in pattern_edges.values()}


def contains_pattern(network: nx.MultiGraph, pattern: nx.MultiGraph) -> bool:
    """True if `pattern` occurs somewhere in `network` (extra stations and segments allowed)."""
    matcher = isomorphism.GraphMatcher(network, pattern, edge_match=_serves_pattern_lines)
    return matcher.subgraph_is_monomorphic()
