#!/usr/bin/env bash
# Release ops-dashboard: mirror THIS working tree to /opt/apps/<APP_NAME>,
# apply the #RELEASE: .env overrides, stamp the released commit, build as svc,
# then RESTART THE SERVICE. Fleet paradigm — adapted from data_acquisition's
# build-release.sh (docs/migration_CLAUDE.md Part 1: "Clean-tree guard",
# "Release provenance"), plus step 6: unlike the batch apps, ops-dashboard is
# a long-running service, so a release is not live until the container is
# recreated from the new copy.
#
# Flow:
#   1. Clean-tree guard      — refuse to release a dirty tree (untracked counts)
#   2. Mirror via tar-pipe   — working tree -> $DEST, with excludes
#   3. Transform .env        — apply #RELEASE:KEY=VALUE, strip markers
#   4. Stamp RELEASE_SHA     — into the DEPLOYED .env only (idempotent)
#   5. chown + build as svc  — image becomes ops-dashboard:svc
#   6. Restart the service   — docker compose up -d from $DEST (recreates)
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
RELEASE_USER="svc"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

for arg in "$@"; do
    case "$arg" in
        --allow-dirty) ALLOW_DIRTY=1 ;;
        *) echo "ERROR: unknown argument '$arg' (only --allow-dirty is accepted)"; exit 1 ;;
    esac
done

# --- 1. Clean-tree guard (BEFORE anything touches $DEST) ---------------------
# The tar-pipe mirrors the WORKING TREE, not a git ref. A dirty release would
# put code in /opt/apps that exists in no commit: unreproducible, untraceable,
# nothing to roll back to. Untracked files count — tar would copy them.
GIT_SHA="unknown"
if git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
    GIT_SHA="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    GIT_BRANCH="$(git -C "$SRC" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

    if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
        if [ "$ALLOW_DIRTY" = "1" ]; then
            echo "WARNING: working tree is dirty, releasing anyway (--allow-dirty)."
        else
            echo "ERROR: working tree is dirty — refusing to release."
            git -C "$SRC" status --short
            exit 1
        fi
    fi

    if git -C "$SRC" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
        AHEAD="$(git -C "$SRC" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
        [ "$AHEAD" -gt 0 ] && echo "WARNING: $AHEAD commit(s) on '$GIT_BRANCH' not pushed to upstream."
    else
        echo "WARNING: branch '$GIT_BRANCH' has no upstream — this release exists only on this host."
    fi
else
    echo "WARNING: $SRC is not a git repository — cannot verify what is being released."
fi

# --- Destination (derived, then re-validated) --------------------------------
APP_NAME="$(grep -E '^APP_NAME=' "$SRC/.env" | head -1 | cut -d= -f2 | tr -d '[:space:]' | tr -d "'\"")"
[ -n "$APP_NAME" ] || { echo "ERROR: APP_NAME not set in $SRC/.env"; exit 1; }
DEST="/opt/apps/$APP_NAME"
case "$DEST" in
    /opt/apps/?*) : ;;
    *) echo "ERROR: refusing unsafe DEST '$DEST'"; exit 1 ;;
esac
if [ "$DEST" = "$SRC" ]; then
    echo "ERROR: SRC and DEST are the same directory — run this from a dev tree, not the release copy."
    exit 1
fi

echo "==> releasing $APP_NAME  commit: $GIT_SHA  ->  $DEST"

# --- 2. Wipe + tar-pipe mirror -----------------------------------------------
# node_modules in $DEST is preserved across releases as build.sh's install
# cache. This app has no gitignored bulk (only .claude/ and .env, verified via
# `git status --ignored`), so the exclude list is minimal — things that must
# never ship. Tracked docs (markdown/, notes/, prompts/, test/) ship on
# purpose: it keeps the release self-documenting and lets the drift check
# (`diff -r` against the dev tree) stay nearly exclusion-free. Verify any
# exclude change by diffing `tar -tf` output, never by eyeballing patterns.
#
# The wipe runs while the OLD container is still serving (its bind mount is
# the directory inode, which survives a contents-only wipe). Between here and
# step 6 the old process serves the NEW static files — cosmetic-only skew for
# a few minutes, accepted to keep the actual outage to the recreate step.
sudo mkdir -p "$DEST"
sudo find "$DEST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
sudo tar -C "$SRC" \
    --exclude='./node_modules' \
    --exclude='*/node_modules' \
    --exclude='./.git' \
    --exclude='./.claude' \
    --exclude='./.agents' \
    --exclude='./.codex' \
    --exclude='*.log' \
    -cf - . | sudo tar -C "$DEST" -xf -

# --- 3. Apply #RELEASE: overrides to the DEPLOYED .env ------------------------
# Two passes over the same file: collect overrides, then rewrite active lines
# and drop the marker lines. Idempotent — after one pass no markers remain.
# For this app that flips USER_ID -> svc, COMPOSE_PROJECT_NAME ->
# ops-dashboard (the production compose project), HOST_PORT -> 8080.
tmp_env="$(mktemp)"
sudo awk '
    FNR==NR {
        if ($0 ~ /^#RELEASE:/) {
            l = substr($0, 10)
            e = index(l, "=")
            if (e > 0) {
                k = substr(l, 1, e-1)
                v = substr(l, e+1)
                sub(/[ \t]+#.*$/, "", v)
                gsub(/^[ \t]+|[ \t]+$/, "", k)
                gsub(/^[ \t]+|[ \t]+$/, "", v)
                ov[k] = v
            }
        }
        next
    }
    {
        if ($0 ~ /^#RELEASE:/) next
        if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
            e = index($0, "=")
            k = substr($0, 1, e-1)
            if (k in ov) { print k "=" ov[k]; next }
        }
        print
    }
' "$DEST/.env" "$DEST/.env" > "$tmp_env"
sudo cp "$tmp_env" "$DEST/.env"
rm -f "$tmp_env"

# --- 4. Stamp RELEASE_SHA (idempotent: delete then append) ---------------------
# server.js prints this on the boot line and every self-log heartbeat carries
# it in its on_boot note, so the util.app_run_logs record identifies the
# commit that produced it. Never set by hand; a dev tree has no key and
# records 'dev-tree' instead.
sudo sed -i '/^# Injected by build-release.sh/d; /^RELEASE_SHA=/d' "$DEST/.env"
printf '\n# Injected by build-release.sh — do not edit by hand.\nRELEASE_SHA=%s\n' \
    "$GIT_SHA" | sudo tee -a "$DEST/.env" >/dev/null

# --- 5. Ownership + build as svc ----------------------------------------------
sudo chown -R "${RELEASE_USER}:docker" "$DEST"
# svc owns it; docker-group members (the admins on this box) can read it for
# preflight/debugging. No wider access.
sudo chmod 640 "$DEST/.env" || true

# svc has no host home (/nonexistent). The docker CLI tolerates that for
# simple commands, but BuildKit mkdirs $HOME/.docker and dies (verified on the
# pilot's first release: "mkdir /nonexistent: permission denied"). NEVER
# HOME=/tmp (/tmp/.docker svc:700 breaks docker for other users) — use the
# private persistent dir the pilot established.
SVC_HOME="/opt/apps/.svc-home"
sudo mkdir -p "$SVC_HOME"
sudo chown "$RELEASE_USER":docker "$SVC_HOME"
sudo chmod 700 "$SVC_HOME"
sudo -u "$RELEASE_USER" env HOME="$SVC_HOME" bash -c "cd '$DEST' && ./build.sh"

sudo chown -R "${RELEASE_USER}:docker" "$DEST"

# --- 6. Restart the service (SERVICE-SPECIFIC, not in the batch references) ----
# A batch app's "restart" is its next cron tick picking up the new copy; a
# long-running service must be recreated or it keeps serving the old code
# forever. `up -d` recreates only on config/image change, so it is also what
# replaces the pre-paradigm stock-node container on the first paradigm
# release. Run as svc so the created container's identity matches production
# doctrine (RUN_USER unset -> entrypoint defaults to svc).
echo "==> restarting service from $DEST"
sudo -u "$RELEASE_USER" env HOME="$SVC_HOME" bash -c \
    "cd '$DEST' && /usr/bin/docker compose up -d && /usr/bin/docker compose ps"

echo "==> release complete: $DEST  commit: $GIT_SHA  image: ops-dashboard:svc"
echo "    verify: grep '^RELEASE_SHA=' $DEST/.env ; curl -s localhost:8080/healthz"
echo "            (cd $DEST && bash preflight-check.sh)"
