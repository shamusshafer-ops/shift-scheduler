# Branching Strategy

## Branch Structure

```
main          ← Production only. Always stable. Never commit directly.
develop       ← Integration branch. All features merge here first.
feature/*     ← New features and changes. Branch off develop.
hotfix/*      ← Urgent production fixes. Branch off main.
release/*     ← Pre-release stabilization. Branch off develop.
```

## Rules

### main
- Protected. No direct commits.
- Only accepts merges from `release/*` or `hotfix/*`
- Every merge = a production deploy

### develop
- No direct commits for features.
- Always reflects the latest completed work.
- Feature branches merge here via Pull Request.

### feature/*
- Branch naming: `feature/short-description` (e.g. `feature/auto-fill-shifts`)
- Always branch from `develop`
- Always merge back into `develop`
- Delete after merge

### hotfix/*
- For urgent production bugs only
- Branch naming: `hotfix/short-description`
- Branch from `main`, merge into BOTH `main` AND `develop`

### release/*
- Branch naming: `release/v1.0`
- Branch from `develop` when ready to ship
- Only bug fixes go in here — no new features
- Merge into `main` when stable, tag with version

## Workflow Example

```bash
# Start a new feature
git checkout develop
git pull origin develop
git checkout -b feature/my-feature

# Work, commit, push
git add .
git commit -m "feat: describe what you did"
git push origin feature/my-feature

# Open a Pull Request → develop on GitHub
# After merge, delete the feature branch
```

## Commit Message Format
```
feat: add something new
fix: correct a bug
docs: update documentation
refactor: restructure code without changing behavior
chore: maintenance tasks
```
