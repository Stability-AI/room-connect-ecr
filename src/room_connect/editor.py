"""High-level editor API that combines Volume and ConnectivityGraph."""

from __future__ import annotations

from pathlib import Path

from room_connect.graph import ConnectivityGraph
from room_connect.volume import Volume


class Editor:
    """High-level editor that links a :class:`Volume` to its :class:`ConnectivityGraph`.

    The editor is the main entry point for programmatic use of room-connect.
    It keeps the volume and graph in sync and provides convenience methods
    for common editing operations.

    Attributes:
        volume: The labelled 3-D volume.
        graph: The connectivity graph derived from the volume.
    """

    def __init__(self, volume: Volume) -> None:
        """Initialise an Editor from a Volume.

        The connectivity graph is initialised with one node per unique
        label in the volume; no edges are added automatically.

        Args:
            volume: The labelled volume to edit.
        """
        self.volume = volume
        self.graph = ConnectivityGraph()
        for label in volume.unique_labels:
            self.graph.add_node(label)

    # ------------------------------------------------------------------
    # Factory helpers
    # ------------------------------------------------------------------

    @classmethod
    def from_numpy(cls, path: str | Path) -> Editor:
        """Create an Editor by loading a volume from a NumPy file.

        Args:
            path: Path to a ``.npy`` file containing a 3-D label array.

        Returns:
            A new :class:`Editor` instance.
        """
        return cls(Volume.from_numpy(path))

    # ------------------------------------------------------------------
    # Editing operations
    # ------------------------------------------------------------------

    def connect(self, source: int, target: int, weight: float = 1.0) -> None:
        """Add a directed edge between two labelled regions.

        Args:
            source: Label of the source region.
            target: Label of the target region.
            weight: Edge weight; defaults to 1.0.
        """
        self.graph.add_edge(source, target, weight=weight)

    def disconnect(self, source: int, target: int) -> None:
        """Remove a directed edge between two labelled regions.

        Args:
            source: Label of the source region.
            target: Label of the target region.
        """
        self.graph.remove_edge(source, target)

    def merge_regions(self, keep: int, remove: int) -> None:
        """Merge two regions by relabelling all voxels of ``remove`` to ``keep``.

        All edges incident to ``remove`` are re-attached to ``keep`` (if
        the resulting edge does not already exist).  The ``remove`` node
        is deleted from the graph.

        Args:
            keep: Label of the region to keep.
            remove: Label of the region to merge into ``keep``.

        Raises:
            ValueError: If either label does not exist in the graph.
        """
        for label in (keep, remove):
            if not self.graph.has_node(label):
                raise ValueError(f"Region {label} does not exist.")

        # Relabel voxels
        self.volume.data[self.volume.data == remove] = keep

        # Re-wire edges
        for pred in self.graph.predecessors(remove):
            if pred != keep and not self.graph.has_edge(pred, keep):
                w = self.graph.get_edge_weight(pred, remove)
                self.graph.add_edge(pred, keep, weight=w)
        for succ in self.graph.neighbors(remove):
            if succ != keep and not self.graph.has_edge(keep, succ):
                w = self.graph.get_edge_weight(remove, succ)
                self.graph.add_edge(keep, succ, weight=w)

        self.graph.remove_node(remove)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        """Save the current volume to a NumPy file.

        Args:
            path: Destination ``.npy`` file path.
        """
        self.volume.to_numpy(path)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def summary(self) -> str:
        """Return a human-readable summary of the editor state.

        Returns:
            A multi-line string describing the volume and graph.
        """
        v = self.volume
        g = self.graph
        lines = [
            f"Volume shape : {v.shape}",
            f"Voxel spacing: {v.spacing}",
            f"Regions      : {len(v.unique_labels)}",
            f"Graph nodes  : {g.node_count}",
            f"Graph edges  : {g.edge_count}",
        ]
        return "\n".join(lines)
