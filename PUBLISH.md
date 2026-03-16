# Publishing

## Releasing

1. Bump the version in `package.json` and commit on your branch
2. Merge to master, push, tag, then push the tag:

```bash
git checkout master
git merge develop
git push origin master
git tag v1.0.0
git push --follow-tags
```

Pushing the `v*` tag triggers CI to build, test, and publish to npm.

To re-release the same version (e.g. after a failed publish), force the tag:

```bash
git tag -f v1.0.0
git push origin v1.0.0 --force
```

## First publish

The package must exist on npm before the CI workflow can publish. Do the initial release manually from the terminal:

```bash
git checkout master
git merge develop
git push origin master
pnpm build
pnpm publish --access public
```

Log in first with `npm login` if needed. After the first version is on npm, add an `NPM_TOKEN` repository secret (Settings > Secrets and variables > Actions) so future tag pushes can publish via CI.

## Switching to trusted publishing

After the first version is on npm, configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) to eliminate the token:

1. On [npmjs.com](https://www.npmjs.com), go to the package **Settings > Trusted Publisher** and configure:
   - **Owner:** `trasherdk`
   - **Repository:** `smtp-channel`
   - **Workflow filename:** `publish.yml`
2. Delete the `NPM_TOKEN` repository secret.

The npm CLI prefers OIDC when available and falls back to the token, so the workflow handles both.
