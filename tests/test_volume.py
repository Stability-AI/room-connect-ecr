"""Tests for Volume."""

from pathlib import Path

import numpy as np
import pytest

from room_connect.volume import Volume


@pytest.fixture()
def label_array() -> np.ndarray:
    """Return a simple 4×4×4 label array with three regions."""
    data = np.zeros((4, 4, 4), dtype=np.intp)
    data[0:2, :, :] = 1
    data[2:4, :, :] = 2
    return data


class TestVolumeInit:
    def test_shape_is_preserved(self, label_array: np.ndarray) -> None:
        v = Volume(label_array)
        assert v.shape == (4, 4, 4)

    def test_default_spacing(self, label_array: np.ndarray) -> None:
        v = Volume(label_array)
        assert v.spacing == (1.0, 1.0, 1.0)

    def test_custom_spacing(self, label_array: np.ndarray) -> None:
        v = Volume(label_array, spacing=(0.5, 0.5, 1.0))
        assert v.spacing == (0.5, 0.5, 1.0)

    def test_non_3d_data_raises(self) -> None:
        bad = np.zeros((4, 4), dtype=np.intp)
        with pytest.raises(ValueError, match="3-D"):
            Volume(bad)


class TestVolumeLabels:
    def test_unique_labels_excludes_background(self, label_array: np.ndarray) -> None:
        v = Volume(label_array)
        assert v.unique_labels == [1, 2]

    def test_unique_labels_empty_volume(self) -> None:
        v = Volume(np.zeros((2, 2, 2), dtype=np.intp))
        assert v.unique_labels == []


class TestVolumeIO:
    def test_round_trip_numpy(self, label_array: np.ndarray, tmp_path: Path) -> None:
        v = Volume(label_array)
        out = tmp_path / "vol.npy"
        v.to_numpy(out)
        v2 = Volume.from_numpy(out)
        np.testing.assert_array_equal(v.data, v2.data)

    def test_from_numpy_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            Volume.from_numpy(tmp_path / "nonexistent.npy")
