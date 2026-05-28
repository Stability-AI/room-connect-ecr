"""Volume loading and processing utilities for room-connect."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt


class Volume:
    """A 3-D labelled volume.

    Each voxel carries an integer label that identifies the region it
    belongs to (0 = background, 1+ = labelled regions).

    Attributes:
        data: Integer array of shape ``(X, Y, Z)`` containing region labels.
        spacing: Physical voxel size in each dimension (mm).
    """

    def __init__(
        self,
        data: npt.NDArray[np.intp],
        spacing: tuple[float, float, float] = (1.0, 1.0, 1.0),
    ) -> None:
        """Initialise a Volume.

        Args:
            data: 3-D integer array of region labels.
            spacing: Physical voxel dimensions ``(dx, dy, dz)`` in mm.

        Raises:
            ValueError: If ``data`` is not a 3-D array.
        """
        if data.ndim != 3:
            raise ValueError(f"Volume data must be 3-D, got {data.ndim}-D array.")
        self.data: npt.NDArray[np.intp] = data
        self.spacing: tuple[float, float, float] = spacing

    # ------------------------------------------------------------------
    # I/O
    # ------------------------------------------------------------------

    @classmethod
    def from_numpy(cls, path: str | Path) -> Volume:
        """Load a volume from a NumPy ``.npy`` file.

        Args:
            path: Path to the ``.npy`` file.

        Returns:
            A new :class:`Volume` instance.

        Raises:
            FileNotFoundError: If ``path`` does not exist.
            ValueError: If the loaded array is not 3-D.
        """
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        data = np.load(path)
        return cls(data.astype(np.intp))

    def to_numpy(self, path: str | Path) -> None:
        """Save the volume data to a NumPy ``.npy`` file.

        Args:
            path: Destination file path.
        """
        np.save(Path(path), self.data)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def shape(self) -> tuple[int, int, int]:
        """Return the ``(X, Y, Z)`` shape of the volume."""
        x, y, z = self.data.shape
        return (x, y, z)

    @property
    def unique_labels(self) -> list[int]:
        """Return the sorted list of unique region labels (excluding 0)."""
        return sorted(int(v) for v in np.unique(self.data) if v != 0)
