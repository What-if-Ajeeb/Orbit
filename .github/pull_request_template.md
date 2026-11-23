<!--
  PR titles must follow Conventional Commits. They become the squash-merge
  commit message on main, which keeps history and release notes parseable.
-->

## Summary

<!-- What changed and why? Link the issue if there is one. -->

## Type of change

- [ ] `feat` — new user-facing behavior
- [ ] `fix` — bug fix
- [ ] `chore` / `build` / `ci` — tooling, dependencies, pipeline
- [ ] `docs` — documentation only
- [ ] `refactor` / `perf` / `test` — no behavior change
- [ ] Breaking change (`!` in the PR title)

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:rn`
- [ ] `npx expo export --platform android --no-bytecode` (for app code changes)
- [ ] Tested on Android / Expo Go (describe below)

<!-- Add screenshots or screen recordings for UI changes. -->

## Release impact

- [ ] No version bump required
- [ ] Version bumped in **both** `app.json` (`expo.version`) and `package.json` to the same `MAJOR.MINOR.PATCH`

## Checklist

- [ ] No secrets, keystores, `.env` files, generated `android/`/`ios/` folders, or logs are committed
- [ ] Docs updated when behavior, config, or workflow changed
- [ ] Migration/rollback path considered (DB schema, release, or native config)
- [ ] I followed the flow in [`docs/GIT_WORKFLOW.md`](../docs/GIT_WORKFLOW.md)
