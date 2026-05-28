"""Tests for Editor."""

from pathlib import Path

import numpy as np
import pytest

from room_connect.editor import Editor
from room_connect.volume import Volume


@pytest.fixture()
def editor() -> Editor:
    """Return an Editor with a simple two-region volume."""
    data = np.zeros((4, 4, 4), dtype=np.intp)
    data[0:2, :, :] = 1
    data[2:4, :, :] = 2
    return Editor(Volume(data))


class TestEditorInit:
    def test_nodes_created_for_each_region(self, editor: Editor) -> None:
        assert editor.graph.node_count == 2

    def test_no_edges_by_default(self, editor: Editor) -> None:
        assert editor.graph.edge_count == 0


class TestEditorConnect:
    def test_connect_adds_edge(self, editor: Editor) -> None:
        editor.connect(1, 2)
        assert editor.graph.edge_count == 1
        assert editor.graph.neighbors(1) == [2]

    def test_disconnect_removes_edge(self, editor: Editor) -> None:
        editor.connect(1, 2)
        editor.disconnect(1, 2)
        assert editor.graph.edge_count == 0


class TestEditorMerge:
    def test_merge_relabels_voxels(self, editor: Editor) -> None:
        editor.merge_regions(keep=1, remove=2)
        assert 2 not in np.unique(editor.volume.data)
        assert 1 in np.unique(editor.volume.data)

    def test_merge_removes_node(self, editor: Editor) -> None:
        editor.merge_regions(keep=1, remove=2)
        assert editor.graph.node_count == 1

    def test_merge_nonexistent_region_raises(self, editor: Editor) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            editor.merge_regions(keep=1, remove=99)

    def test_merge_rewires_edges(self) -> None:
        data = np.zeros((6, 4, 4), dtype=np.intp)
        data[0:2, :, :] = 1
        data[2:4, :, :] = 2
        data[4:6, :, :] = 3
        ed = Editor(Volume(data))
        ed.connect(2, 3)
        ed.merge_regions(keep=1, remove=2)
        # Edge 2→3 should become 1→3
        assert ed.graph.neighbors(1) == [3]


class TestEditorSummary:
    def test_summary_contains_shape(self, editor: Editor) -> None:
        s = editor.summary()
        assert "(4, 4, 4)" in s

    def test_summary_contains_region_count(self, editor: Editor) -> None:
        s = editor.summary()
        assert "2" in s


class TestEditorFromNumpy:
    def test_from_numpy(self, tmp_path: Path) -> None:
        data = np.zeros((4, 4, 4), dtype=np.intp)
        data[:, :, :] = 1
        np.save(tmp_path / "vol.npy", data)
        ed = Editor.from_numpy(tmp_path / "vol.npy")
        assert ed.graph.node_count == 1
