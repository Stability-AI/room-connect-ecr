"""Connectivity graph data model for room-connect."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import networkx as nx


@dataclass
class ConnectivityGraph:
    """A directed graph representing volumetric region connectivity.

    Nodes represent volumetric regions (rooms, cells, cavities).
    Edges represent adjacency or passage relationships between regions.

    Attributes:
        _graph: The underlying NetworkX directed graph.
    """

    _graph: nx.DiGraph = field(default_factory=nx.DiGraph, repr=False)

    # ------------------------------------------------------------------
    # Node operations
    # ------------------------------------------------------------------

    def add_node(self, node_id: int, **attrs: Any) -> None:
        """Add a node to the graph.

        Args:
            node_id: Unique integer identifier for the node.
            **attrs: Arbitrary keyword attributes stored on the node.
        """
        self._graph.add_node(node_id, **attrs)

    def remove_node(self, node_id: int) -> None:
        """Remove a node and all its incident edges.

        Args:
            node_id: Integer ID of the node to remove.

        Raises:
            ValueError: If ``node_id`` does not exist in the graph.
        """
        if node_id not in self._graph:
            raise ValueError(f"Node {node_id} does not exist in the graph.")
        self._graph.remove_node(node_id)

    # ------------------------------------------------------------------
    # Edge operations
    # ------------------------------------------------------------------

    def add_edge(self, source: int, target: int, weight: float = 1.0) -> None:
        """Add a directed edge between two nodes.

        Args:
            source: Integer node ID of the source node.
            target: Integer node ID of the target node.
            weight: Edge weight; defaults to 1.0.

        Raises:
            ValueError: If either node ID does not exist in the graph.
        """
        for node in (source, target):
            if node not in self._graph:
                raise ValueError(f"Node {node} does not exist in the graph.")
        self._graph.add_edge(source, target, weight=weight)

    def remove_edge(self, source: int, target: int) -> None:
        """Remove a directed edge.

        Args:
            source: Integer node ID of the source node.
            target: Integer node ID of the target node.

        Raises:
            ValueError: If the edge does not exist.
        """
        if not self._graph.has_edge(source, target):
            raise ValueError(f"Edge ({source}, {target}) does not exist.")
        self._graph.remove_edge(source, target)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    @property
    def node_count(self) -> int:
        """Return the number of nodes in the graph."""
        return self._graph.number_of_nodes()

    @property
    def edge_count(self) -> int:
        """Return the number of edges in the graph."""
        return self._graph.number_of_edges()

    def neighbors(self, node_id: int) -> list[int]:
        """Return the direct successors of a node.

        Args:
            node_id: Integer ID of the node.

        Returns:
            Sorted list of successor node IDs.

        Raises:
            ValueError: If ``node_id`` does not exist in the graph.
        """
        if node_id not in self._graph:
            raise ValueError(f"Node {node_id} does not exist in the graph.")
        return sorted(self._graph.successors(node_id))

    def predecessors(self, node_id: int) -> list[int]:
        """Return the direct predecessors of a node.

        Args:
            node_id: Integer ID of the node.

        Returns:
            Sorted list of predecessor node IDs.

        Raises:
            ValueError: If ``node_id`` does not exist in the graph.
        """
        if node_id not in self._graph:
            raise ValueError(f"Node {node_id} does not exist in the graph.")
        return sorted(self._graph.predecessors(node_id))

    def has_node(self, node_id: int) -> bool:
        """Return ``True`` if ``node_id`` exists in the graph.

        Args:
            node_id: Integer ID to check.
        """
        return node_id in self._graph

    def has_edge(self, source: int, target: int) -> bool:
        """Return ``True`` if a directed edge from ``source`` to ``target`` exists.

        Args:
            source: Source node ID.
            target: Target node ID.
        """
        return self._graph.has_edge(source, target)

    def get_edge_weight(self, source: int, target: int) -> float:
        """Return the weight of the edge from ``source`` to ``target``.

        Args:
            source: Source node ID.
            target: Target node ID.

        Returns:
            The edge weight.

        Raises:
            ValueError: If the edge does not exist.
        """
        if not self._graph.has_edge(source, target):
            raise ValueError(f"Edge ({source}, {target}) does not exist.")
        return float(self._graph[source][target].get("weight", 1.0))
