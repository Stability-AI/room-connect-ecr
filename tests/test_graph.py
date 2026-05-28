"""Tests for ConnectivityGraph."""

import pytest

from room_connect.graph import ConnectivityGraph


@pytest.fixture()
def simple_graph() -> ConnectivityGraph:
    """Return a graph with nodes 1, 2, 3 and edge 1→2."""
    g = ConnectivityGraph()
    g.add_node(1)
    g.add_node(2)
    g.add_node(3)
    g.add_edge(1, 2)
    return g


class TestNodes:
    def test_add_node_increases_count(self) -> None:
        g = ConnectivityGraph()
        g.add_node(10)
        assert g.node_count == 1

    def test_remove_node_decreases_count(self, simple_graph: ConnectivityGraph) -> None:
        simple_graph.remove_node(3)
        assert simple_graph.node_count == 2

    def test_remove_node_also_removes_incident_edges(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        simple_graph.remove_node(1)
        assert simple_graph.edge_count == 0

    def test_remove_nonexistent_node_raises(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            simple_graph.remove_node(99)


class TestEdges:
    def test_add_edge_increases_count(self, simple_graph: ConnectivityGraph) -> None:
        simple_graph.add_edge(2, 3)
        assert simple_graph.edge_count == 2

    def test_add_edge_missing_source_raises(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            simple_graph.add_edge(99, 1)

    def test_add_edge_missing_target_raises(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            simple_graph.add_edge(1, 99)

    def test_remove_edge_decreases_count(self, simple_graph: ConnectivityGraph) -> None:
        simple_graph.remove_edge(1, 2)
        assert simple_graph.edge_count == 0

    def test_remove_nonexistent_edge_raises(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            simple_graph.remove_edge(2, 3)


class TestNeighbors:
    def test_neighbors_returns_successors(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        assert simple_graph.neighbors(1) == [2]

    def test_neighbors_empty_for_leaf(self, simple_graph: ConnectivityGraph) -> None:
        assert simple_graph.neighbors(2) == []

    def test_neighbors_nonexistent_node_raises(
        self, simple_graph: ConnectivityGraph
    ) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            simple_graph.neighbors(99)
