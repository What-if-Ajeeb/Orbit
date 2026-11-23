#!/usr/bin/env bash
# Configure GitHub repo merge settings + protect `main`.
# Requires: GitHub CLI (`gh`) authenticated with admin access to the repo.
#
# Usage:
#   bash scripts/git/protect-main.sh --dry-run
#   bash scripts/git/protect-main.sh
set -euo pipefail

dry_run=false
branch="main"

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [branch]"
      exit 0
      ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) branch="$arg" ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✖ GitHub CLI (gh) is not installed.

Install it first:
  https://cli.github.com/manual/installation
Then authenticate:
  gh auth login

Branch protection can only be configured through the GitHub API, not over Git SSH.
EOF
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "✖ gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

read -r -d '' protection <<JSON || true
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Validate", "Build Android", "PR title"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo "Repository: $repo"
echo "Protected branch: $branch"
echo "Required checks: Validate, Build Android, PR title"
echo "Merge policy: squash only, delete branch after merge, linear history"
echo

if $dry_run; then
  echo "[dry-run] PUT repos/$repo/branches/$branch/protection"
  printf '%s\n' "$protection"
  echo
  echo "[dry-run] PATCH repos/$repo (squash-only + auto-delete branches)"
  exit 0
fi

gh api --method PUT "repos/$repo/branches/$branch/protection" --input - <<<"$protection" >/dev/null
echo "✓ Branch protection applied to $branch"

gh api --method PATCH "repos/$repo" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_update_branch=true >/dev/null
echo "✓ Repo merge settings: squash-only, auto-delete head branches"

echo
echo "Also configure (one-time, in the GitHub UI):"
echo "  Settings → Environments → 'release' → required reviewers"
echo "  Settings → Secrets and variables → Actions → ORBIT_* signing secrets"
