#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "::error::release_tag is required."
  exit 1
fi

APP_VERSION="$(node -p "require('./app.json').expo.version")"
PKG_VERSION="$(node -p "require('./package.json').version")"
EXPECTED_TAG="v${APP_VERSION}"

if [ "$APP_VERSION" != "$PKG_VERSION" ]; then
  echo "::error::app.json version ($APP_VERSION) and package.json version ($PKG_VERSION) differ."
  exit 1
fi

if [ "$TAG" != "$EXPECTED_TAG" ]; then
  echo "::error::release_tag must be ${EXPECTED_TAG} (v<app.json version>), got '${TAG}'."
  exit 1
fi

if ! printf '%s' "$APP_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::Version '$APP_VERSION' must be MAJOR.MINOR.PATCH."
  exit 1
fi

IFS=. read -r major minor patch <<< "$APP_VERSION"
if [ "$minor" -ge 1000 ] || [ "$patch" -ge 1000 ]; then
  echo "::error::MINOR and PATCH must be below 1000 to fit versionCode."
  exit 1
fi

if [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    echo "::error::A GitHub Release for $TAG already exists. Refusing to overwrite it."
    exit 1
  fi

  ref_json="$(gh api -H "Accept: application/vnd.github+json" \
    "repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}" 2>/dev/null || true)"
  if [ -n "$ref_json" ]; then
    obj_type="$(printf '%s' "$ref_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).object.type||'')}catch{console.log('')}})")"
    obj_sha="$(printf '%s' "$ref_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).object.sha||'')}catch{console.log('')}})")"
    tag_sha="$obj_sha"
    if [ "$obj_type" = "tag" ] && [ -n "$obj_sha" ]; then
      tag_obj="$(gh api -H "Accept: application/vnd.github+json" \
        "repos/${GITHUB_REPOSITORY}/git/tags/${obj_sha}" 2>/dev/null || true)"
      tag_sha="$(printf '%s' "$tag_obj" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).object.sha||'')}catch{console.log('')}})")"
    fi
    if [ -n "${GITHUB_SHA:-}" ] && [ -n "$tag_sha" ] && [ "$tag_sha" != "$GITHUB_SHA" ]; then
      echo "::error::Tag $TAG points to $tag_sha, not workflow commit ${GITHUB_SHA}. Refusing to publish mismatched artifacts."
      exit 1
    fi
    echo "Tag $TAG resolves to ${tag_sha:-unknown}; workflow commit ${GITHUB_SHA:-unknown}."
  else
    echo "Tag $TAG does not exist yet; release may create it at ${GITHUB_SHA:-HEAD}."
  fi
fi

echo "release_tag=$TAG"
echo "app_version=$APP_VERSION"
echo "version_code=$(( major * 1000000 + minor * 1000 + patch ))"
