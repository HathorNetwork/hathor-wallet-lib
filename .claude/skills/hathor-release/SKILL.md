---
name: hathor-release
description: Manage Hathor wallet-lib release process. Use when initiating a release (PR from master to release branch) or bumping version (minor/patch/major). Handles PR creation with proper templates, reviewer assignment, labels, and GitHub project integration.
# model: inherit
# allowedTools: Bash(gh:*),Bash(git:*),Bash(npm version:*),Read,Grep,Glob
---

# Hathor Release Process

## Commands

- `/hathor-release init <version>` - Initiate release process (PR master → release)
- `/hathor-release bump <type>` - Bump version (minor|patch|major)

## 1. Initiate Release (`init`)

Create PR from `master` to `release` branch.

### Steps

1. Get current version from package.json
2. Create PR using `gh`:

```bash
gh pr create \
  --base release \
  --head master \
  --title "Release v<VERSION>" \
  --body "$(cat <<'EOF'
### Description

Start the release process for version `<VERSION>`.
This PR will merge any changes on `master` into `release` branch.
EOF
)" \
  --label "enhancement" \
  --reviewer "<CODEOWNER>,<RECENT_DEV>"
```

3. Add to GitHub project:

```bash
gh pr edit <PR_NUMBER> --add-project "Hathor Network"
```

### Reviewer Selection

- **Code owner**: Check `.github/CODEOWNERS` (currently `@pedroferreira1`)
- **Recent dev**: Run `git log --oneline -20 --format="%an" | grep -v "<CODEOWNER>" | head -1` to find last contributor other than code owner

## 2. Bump Version (`bump`)

Create version bump PR on `release` branch.

### Steps

1. Checkout and update release branch:

```bash
git checkout release
git pull --rebase
```

2. Bump version (no git tag):

```bash
npm version <TYPE> --no-git-tag-version
```

Where `<TYPE>` is `minor`, `patch`, or `major`.

3. Get new version from package.json

4. Create bump branch and commit:

```bash
git checkout -b chore/bump-v<NEW_VERSION>
git add package.json package-lock.json
git commit -m "chore: bumped to v<NEW_VERSION>"
git push -u origin chore/bump-v<NEW_VERSION>
```

5. Create PR:

```bash
gh pr create \
  --base release \
  --head chore/bump-v<NEW_VERSION> \
  --title "chore: bump v<NEW_VERSION>" \
  --body "$(cat <<'EOF'
### Acceptance Criteria
- Bump to v<NEW_VERSION>

### Security Checklist
- [x] Make sure you do not include new dependencies in the project unless strictly necessary and do not include dev-dependencies as production ones. More dependencies increase the possibility of one of them being hijacked and affecting us.
EOF
)" \
  --label "enhancement" \
  --reviewer "<CODEOWNER>,<RECENT_DEV>"
```

6. Add to GitHub project:

```bash
gh pr edit <PR_NUMBER> --add-project "Hathor Network"
```

## Reminders

After release PR is merged:
- Bump the version using the `bump` command
- Communicate the release version on Slack
