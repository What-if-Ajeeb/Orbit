#!/usr/bin/env bash
# Preview or delete local branches already merged into origin/main.
# Remote branches are never touched.
#
# Usage:
#   bash scripts/git/cleanup-branches.sh           # preview
#   bash scripts/git/cleanup-branches.sh --apply   # delete
set -euo pipefail

apply=false
[[ "${1:-}" == "--apply" ]] && apply=true

root="$(git rev-parse --show-toplevel)"
cd "$root"

git fetch --prune origin

current="$(git symbolic-ref --quiet --short HEAD || true)"
mapfile -t merged < <(
  git branch --merged origin/main --format='%(refname:short)' |
    grep -vE "^(main|master|release/|${current}$)" || true
)

if (( ${#merged[@]} == 0 )); then
  echo "No merged local branches to clean up."
else
  echo "Merged into origin/main:"
  printf '  %s\n' "${merged[@]}"
  if $apply; then
    for b in "${merged[@]}"; do
      git branch -d "$b"
    done
  else
    echo
    echo "Preview only. Re-run with --apply to delete them."
  fi
fi

echo
unmerged="$(git branch --no-merged origin/main --format='%(refname:short)' | grep -vE '^(main|master)$' || true)"
if [[ -n "$unmerged" ]]; then
  echo "Not merged (kept):"
  printf '  %s\n' $unmerged
fi
