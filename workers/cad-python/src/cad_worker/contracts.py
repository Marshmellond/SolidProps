"""Protocol v1 contracts. JSON keys are deliberately camelCase, never auto-renamed."""
from typing import Literal, TypedDict, NotRequired

class Session(TypedDict):
    id: str
    cadId: str
    label: str
    pid: NotRequired[int]
    version: str
    executable: NotRequired[str]
    connectable: bool
    detail: str

class Diagnostic(TypedDict):
    cadId: str
    level: Literal['info', 'warning', 'error']
    message: str

class Capabilities(TypedDict):
    cadId: str
    displayName: str
    writable: bool
    configurations: bool
    designated: bool
    notes: str

class Property(TypedDict):
    name: str
    value: str
    valueType: str
    writable: bool
    reason: str
    evaluated: str
    designated: NotRequired[bool]

class Model(TypedDict):
    id: str
    name: str
    path: str
    kind: Literal['assembly', 'part']
    configuration: str
    scope: str
    properties: list[Property]
    writable: bool
    reason: str
    dirty: bool

class Occurrence(TypedDict):
    id: str
    name: str
    modelId: str | None
    children: list['Occurrence']
    status: str

class Snapshot(TypedDict):
    id: str
    sessionId: str
    title: str
    cadId: str
    scope: str
    models: list[Model]
    root: Occurrence
    warnings: list[str]

class Change(TypedDict):
    operation: NotRequired[Literal['add', 'update', 'delete']]
    modelId: str
    propertyName: str
    oldValue: str
    newValue: str

class WriteResult(TypedDict):
    modelId: str
    propertyName: str
    success: bool
    message: str
    saved: bool
    verified: bool

class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def capabilities(cad_id, writable=False, configurations=False, designated=False, notes='', display_name=None):
    return dict(cadId=cad_id, displayName=display_name or {'solidworks': 'SolidWorks'}.get(cad_id, cad_id), writable=writable, configurations=configurations, designated=designated, notes=notes)


def result(change, success=False, message='', saved=False, verified=False):
    return dict(modelId=change['modelId'], propertyName=change['propertyName'], success=success, message=message, saved=saved, verified=verified)
