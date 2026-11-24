# orbit-mobile-sandbox

## Unreleased

### Fixed

- Android: after the isolated service process dies, keep the existing binding instead of
  dropping it, so the next call no longer creates a second leaked binding.
- Android: handle `onBindingDied` and `onNullBinding`; both now unbind cleanly and fail
  pending calls with `SANDBOX_BIND_FAILED`.
- Android: calls that timed out while queued for a (re)bind are no longer sent to the service.
- Android: `messenger` and `connection` are `@Volatile` (they are touched from several threads).
- Rust core: `version` must be exactly `MAJOR.MINOR.PATCH`; `1` and `1.2` were wrongly accepted.
- Rust core: removed an unreachable `return` match arm.

### Changed

- `describe` now reports every enforced limit (`maxStackItems`, `maxEnvelopeBytes`), matching
  the docs. The TypeScript types treat the two new fields as optional for older cores.

### Notes

- This file previously contained the unedited `expo-module-template` changelog.
