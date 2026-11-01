# GitHub workflow for coding agents

Use this procedure when a person asks an agent to publish a workspace to GitHub. The person must authorize GitHub in their own browser. Never ask them to paste a password or personal access token into chat, and never commit credentials.

Each agent and execution environment needs its own authorization. Do not copy another agent's token or credential files.

## 1. Inspect before changing Git state

From the project root:

```sh
git status --short --branch
git remote -v
```

If this is not yet a repository:

```sh
git init -b main
git remote add origin https://github.com/OWNER/REPOSITORY.git
```

If `origin` already exists but points elsewhere, confirm the intended destination with the person and then use:

```sh
git remote set-url origin https://github.com/OWNER/REPOSITORY.git
```

Inspect the destination before pushing:

```sh
git ls-remote origin
```

No returned refs normally means an empty repository. If refs exist, fetch and inspect them:

```sh
git fetch origin
git log --oneline --all -10
git ls-tree -r --name-only origin/main | head -80
```

Do not overwrite, reset, merge, or force-push existing work without explicit approval. Prefer an empty destination or a separate branch when the repository contains a different project.

## 2. Exclude secrets and generated files

At minimum, ignore dependencies, builds, local media/data, logs, and environment files. Keep a reviewed `.env.example` without real credentials:

```gitignore
node_modules/
dist/
.data/
.env
.env.*
!.env.example
```

Then stage and inspect what will actually be committed:

```sh
git add .
git diff --cached --stat
git diff --cached --name-only
git status --short --ignored
```

Do not rely only on a filename scan. Review configuration, authentication, storage, and test fixtures for embedded secrets or private data.

## 3. Create the commit

Use the person's real GitHub identity or their privacy-preserving GitHub `noreply` address:

```sh
git config user.name 'GITHUB_USERNAME'
git config user.email 'GITHUB_USERNAME@users.noreply.github.com'
git commit -m 'Describe the implementation clearly'
```

## 4. Install and authorize GitHub CLI

On Debian/Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y gh
```

For an ephemeral agent environment, keep credentials outside the project and outside persisted workspace files. Use the same temporary home for both GitHub CLI and the subsequent push:

```sh
export GITHUB_AGENT_HOME=/tmp/agent-github-home
mkdir -p "$GITHUB_AGENT_HOME"
HOME="$GITHUB_AGENT_HOME" gh auth login \
  --hostname github.com \
  --git-protocol https \
  --web
```

GitHub CLI displays a one-time code and `https://github.com/login/device`. Give those to the person and wait for them to approve the request in their browser. The agent must not invent a code or claim authorization before GitHub CLI reports success.

In a non-interactive shell that needs the confirmation answers supplied automatically:

```sh
printf 'y\n\n' | HOME="$GITHUB_AGENT_HOME" gh auth login \
  --hostname github.com \
  --git-protocol https \
  --web
```

Authentication alone does not necessarily configure Git's credential helper. Run this separately:

```sh
HOME="$GITHUB_AGENT_HOME" gh auth setup-git --hostname github.com
```

Check the resulting session without printing the token:

```sh
HOME="$GITHUB_AGENT_HOME" gh auth status
```

## 5. Permit an existing Actions workflow when required

GitHub rejects a push containing `.github/workflows/*` if the OAuth grant lacks the `workflow` scope. The error resembles:

```text
refusing to allow an OAuth App to create or update workflow ... without `workflow` scope
```

Do not delete CI to bypass the protection. Request the additional scope and let the person approve another device code:

```sh
printf '\n' | HOME="$GITHUB_AGENT_HOME" gh auth refresh \
  --hostname github.com \
  --scopes workflow
```

Wait for GitHub CLI to report that authentication completed before retrying the push.

## 6. Push and verify

```sh
HOME="$GITHUB_AGENT_HOME" GIT_TERMINAL_PROMPT=0 git push -u origin main
git ls-remote --heads origin main
git status --short --branch
```

The remote commit must match the local commit. A clean status does not itself prove that the push succeeded; verify the remote ref or inspect the repository on GitHub.

For later changes, use a focused commit and a normal non-forced push:

```sh
git add PATHS_REVIEWED
git diff --cached
git commit -m 'Describe the focused change'
HOME="$GITHUB_AGENT_HOME" git push
```

## 7. Clean up credentials when access is no longer needed

```sh
HOME="$GITHUB_AGENT_HOME" gh auth logout --hostname github.com
rm -rf "$GITHUB_AGENT_HOME"
```

Never place the temporary credential home inside the repository. Treat logs, copied configuration, and workspace snapshots as potentially sensitive even when a token appears masked.
