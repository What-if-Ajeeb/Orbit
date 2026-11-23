#!/usr/bin/env bash
# One-time (idempotent) local Git setup for the Orbit workflow.
# Usage: bash scripts/git/setup.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "Configuring local Git for $root ..."

# Commit hooks shipped with the repo.
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/commit-msg .githooks/pre-push
echo "  ✓ core.hooksPath -> .githooks"

# Sensible defaults for a rebase-based, PR-driven flow.
git config --local fetch.prune true
git config --local pull.rebase true
git config --local rebase.autoStash true
git config --local rerere.enabled true
git config --local merge.conflictStyle zdiff3
git config --local push.default current
git config --local push.autoSetupRemote true
git config --local init.defaultBranch main
git config --local tag.sort version:refname
git config --local branch.sort -committerdate
echo "  ✓ fetch.prune, pull.rebase, rerere, autoSetupRemote"

# Helpful aliases.
git config --local alias.lg "log --graph --oneline --decorate --all"
git config --local alias.sync "!git fetch --prune && git rebase origin/main"
git config --local alias.undo "reset --soft HEAD~1"
git config --local alias.unstage "restore --staged --"
git config --local alias.last "log -1 --stat"
echo "  ✓ aliases: lg, sync, undo, unstage, last"

# Identity: never silently overwrite an existing value.
if [[ -n "${GIT_NAME:-}" ]]; then
  git config --local user.name "$GIT_NAME"
fi
if [[ -n "${GIT_EMAIL:-}" ]]; then
  git config --local user.email "$GIT_EMAIL"
fi

name="$(git config user.name || true)"
email="$(git config user.email || true)"
if [[ -z "$name" || -z "$email" ]]; then
  echo
  echo "⚠ Git identity is not fully configured."
  echo "  git config --local user.name  \"Your Name\""
  echo "  git config --local user.email \"you@example.com\""
elif [[ "$email" == *@local || "$email" == *@example.com ]]; then
  echo
  echo "⚠ Commit identity '$name <$email>' is not linked to a GitHub account."
  echo "  Fix: git config --local user.email \"<your-github-email>\""
fi

echo
echo "Local setup complete."
echo "Next: protect the remote branch with"
echo "  bash scripts/git/protect-main.sh --dry-run   # preview"
echo "  bash scripts/git/protect-main.sh             # apply (needs gh auth)"
