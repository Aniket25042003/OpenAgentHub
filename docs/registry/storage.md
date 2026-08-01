# Registry — Archive storage

`app/store.py`

## `ArchiveStore`

Filesystem-backed archive storage; blobs never go in the database.

- Root: `REGISTRY_STORAGE_DIR` (default `./storage`), created on init.
- Layout: `<root>/<namespace>/<name>/<version>.ahb`.
- Comment in the class notes a MinIO/S3 adapter can be swapped in later.

```python
class ArchiveStore:
    def __init__(self, root: str | None = None): ...
    async def put(self, namespace, name, version, data: bytes) -> None
    async def get(self, namespace, name, version) -> bytes | None
    async def delete(self, namespace, name, version) -> None
```

All I/O is offloaded to the event loop via `loop.run_in_executor(None, ...)`
so reads/writes never block the async server.

## Path safety (`_safe_segment`)

Every segment (namespace, name, version) is checked before joining onto the
root; invalid values raise `ArchiveStoreError`:

- empty string, `.` or `..`,
- contains `/`, `\`, or a NUL byte.

This prevents `PUT /agents/../../etc/...`-style traversal from writing outside
the store. Regression-tested.

## Upload cap

- The publish router reads `archive.read(settings.max_archive_bytes + 1)` and
  returns **413** if the body exceeds `REGISTRY_MAX_ARCHIVE_BYTES` before
  anything is stored.
- The signature file is capped at 1 MiB (413).

## Download

`get(...)` returns the raw bytes or `None`. The download endpoint increments
`download_count` per successful download. A missing blob → 404 "archive
missing on server".

## Integrity

- `sha256` is computed at publish (`sha256_hex(archive_data)`) and stored on
  the `AgentVersion`.
- The client recomputes sha256 of what it downloads and compares against the
  version detail's signature — a corrupted blob on disk therefore fails
  install.
