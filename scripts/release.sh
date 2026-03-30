#!/usr/bin/env bash
set -e

# Release script: bump version (or re-tag current), build, test, commit, tag, push.
# Usage: pnpm release [patch|minor|major] [--no-push]
# Or: ./scripts/release.sh patch [--no-push]
# No bump level = re-release current version (force tag).

BUMP=""
NO_PUSH=""
while [[ $# -ne 0 ]]; do
  case "$1" in
    patch|minor|major) BUMP="$1" ;;
    --no-push) NO_PUSH=1 ;;
    *) ;;  # first release or re-release; no bump
  esac
  shift
done

ORIG_BRANCH="$(git branch --show-current)"

echo "> Building..."
pnpm build

echo "> Testing..."
pnpm test

if [[ -n "$BUMP" ]]; then
  echo "> Bumping version ($BUMP)..."
  pnpm version "$BUMP"
else
  echo "> Re-release: no version bump"
fi

if [[ -z "$NO_PUSH" ]]; then
  echo "> Pushing $ORIG_BRANCH..."
  git push origin "$ORIG_BRANCH"

  if [[ "$ORIG_BRANCH" != "master" ]]; then
    echo "> Checking out master and merging $ORIG_BRANCH..."
    git checkout master
    git merge "$ORIG_BRANCH"
    echo "> Pushing master..."
    git push origin master
  fi

  VERSION="$(node -p "require('./package.json').version")"
  TAG="v$VERSION"
  echo "> Tagging $TAG..."
  git tag -f "$TAG"
  git push origin "$TAG" --force

  echo "> Returning to $ORIG_BRANCH..."
  git checkout "$ORIG_BRANCH"

  echo "Done. CI will publish to npm on tag push."
else
  echo "Done. Run 'git push --follow-tags' when ready."
fi
