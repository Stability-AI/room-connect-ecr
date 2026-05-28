"""3D renderer stub — wraps PyVista for volume and graph visualisation."""

from __future__ import annotations

# NOTE: PyVista is an optional heavy dependency. Import it lazily so that
# unit tests and CI environments that lack a display server can still import
# the rest of the package.


def render(editor: object) -> None:  # type: ignore[type-arg]
    """Launch an interactive 3D window for the given editor.

    Args:
        editor: An :class:`~room_connect.editor.Editor` instance.

    Raises:
        ImportError: If PyVista is not installed.
    """
    try:
        import pyvista as pv  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "PyVista is required for 3D rendering. "
            'Install it with: pip install "room-connect[dev]"'
        ) from exc

    # Placeholder — full implementation to follow.
    raise NotImplementedError("3D renderer is not yet implemented.")
