"""Explicit adapter registry. New CAD support is opt-in, never auto-loaded."""
from dataclasses import dataclass
from typing import Callable, Protocol
from .contracts import Capabilities, Session, Snapshot


class CadAdapter(Protocol):
    session: Session
    capabilities: Capabilities

    def snapshot(self, scope: str) -> Snapshot: ...
    def apply(self, snapshot: Snapshot, changes: list[dict]) -> dict: ...
    def close(self) -> None: ...


@dataclass(frozen=True)
class CadPlugin:
    cad_id: str
    display_name: str
    process_name: str
    progid: str
    factory: Callable[[Session], CadAdapter]


def builtin_plugins() -> tuple[CadPlugin, ...]:
    from .solidworks import SolidWorksAdapter
    return (CadPlugin('solidworks', 'SolidWorks', 'sldworks.exe',
                      'SldWorks.Application', SolidWorksAdapter),)
