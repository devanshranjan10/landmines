"""Release distribution over the WAN.

The origin server pushes a release to the sites. A site that already has the release can relay it to
other sites. `links` lists the directed transfers that are possible as (source, destination, cost)
tuples; cost is a positive number (transfer price for one release). Links never point at the origin.
"""
import networkx as nx

Link = tuple[str, str, float]


def link_graph(links: list[Link]) -> nx.DiGraph:
    graph = nx.DiGraph()
    for src, dst, cost in links:
        graph.add_edge(src, dst, cost=cost)
    return graph


def unreachable(links: list[Link], origin: str) -> set[str]:
    """Sites that cannot get the release at all."""
    graph = link_graph(links)
    graph.add_node(origin)
    return set(graph) - nx.descendants(graph, origin) - {origin}


def relay_plan(links: list[Link], origin: str) -> dict[str, str]:
    """Cheapest way to get the release to every site: {site: site it receives the release from}."""
    raise NotImplementedError
