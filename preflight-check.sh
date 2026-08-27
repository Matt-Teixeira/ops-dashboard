#!/usr/bin/env bash
# Preflight for ops-dashboard — validates the environment the service will
# actually use. Fleet paradigm (data_acquisition/docs/migration_CLAUDE.md);
# adapted from monday's preflight (closest shape: pg_net only, no file
# logger). A clean run reports ZERO warnings: treat a persistent warning as a
# bug in the check itself, or it trains people to ignore output.
#
# Exit codes: 0 = pass (or warnings only), 1 = critical errors found.
set -u
cd "$(dirname "$0")"

ERRORS=0; WARNINGS=0; OKS=0
ok()    { echo "  OK    $*"; OKS=$((OKS+1)); }
warn()  { echo "  WARN  $*"; WARNINGS=$((WARNINGS+1)); }
error() { echo "  ERROR $*"; ERRORS=$((ERRORS+1)); }
info()  { echo "        $*"; }
section(){ echo; echo "== $* =="; }

# Read KEY= from .env, stripping quotes, dotenv-style inline comments and
# trailing whitespace. NEVER source a fleet .env (the $$-in-URI lesson).
env_val() {
    grep "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- \
        | sed -e 's/[[:space:]]\+#.*$//' -e 's/[[:space:]]*$//' \
              -e "s/^['\"]//" -e "s/['\"]$//"
}

# ---------------------------------------------------------------- 1. host files
section "Host files"
# This app writes NO files (self-log goes to the DB), so there is no output or
# log directory to validate — only the read-only SSL CA the compose mounts.
PG_SSL_PATH_V="$(env_val PG_SSL_PATH)"
PG_SSLMODE_V="$(env_val PG_SSLMODE)"; PG_SSLMODE_V="${PG_SSLMODE_V:-disable}"
case "$PG_SSLMODE_V" in
    verify-ca|verify-full)
        if [ -n "$PG_SSL_PATH_V" ] && [ -r "$PG_SSL_PATH_V" ]; then
            ok "PG_SSL_PATH readable ($PG_SSL_PATH_V) — required by PG_SSLMODE=$PG_SSLMODE_V"
        else
            error "PG_SSLMODE=$PG_SSLMODE_V but PG_SSL_PATH ($PG_SSL_PATH_V) missing/unreadable — db/ssl.js fails closed at boot"
        fi ;;
    require|disable)
        if [ -n "$PG_SSL_PATH_V" ] && [ ! -r "$PG_SSL_PATH_V" ]; then
            warn "PG_SSL_PATH ($PG_SSL_PATH_V) not readable — unused at PG_SSLMODE=$PG_SSLMODE_V, but fails closed if the mode is raised to verify-*"
        else
            ok "PG_SSLMODE=$PG_SSLMODE_V (CA not required by db/ssl.js at this mode)"
        fi ;;
    *) error ".env: PG_SSLMODE '$PG_SSLMODE_V' not one of disable|require|verify-ca|verify-full" ;;
esac

# ------------------------------------------------------------------- 2. docker
section "Docker"
if docker ps >/dev/null 2>&1; then ok "docker daemon reachable"; else error "docker daemon not reachable as $(id -un)"; fi
if id -nG | grep -qw docker; then ok "$(id -un) is in the docker group"; else error "$(id -un) not in docker group"; fi
if docker compose version >/dev/null 2>&1; then ok "docker compose available"; else error "docker compose not available"; fi

USER_ID_V="$(env_val USER_ID)"
if [ -n "$USER_ID_V" ]; then
    if docker image inspect "ops-dashboard:${USER_ID_V}" >/dev/null 2>&1; then
        ok "image ops-dashboard:${USER_ID_V} present"
    else
        error "image ops-dashboard:${USER_ID_V} missing — run: bash build.sh"
    fi
fi

# ----------------------------------------------------------------- 3. networks
section "Networks"
if docker network inspect pg_net >/dev/null 2>&1; then ok "network pg_net exists"; else error "network pg_net missing"; fi

# --------------------------------------------------------------------- 4. .env
section ".env"
if [ ! -f .env ]; then
    error ".env missing — copy .env.example and fill it in"
else
    REQUIRED="APP_NAME USER_ID COMPOSE_PROJECT_NAME HOST_PORT PORT
              PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PG_SSLMODE
              DOCKER_GID UID_0 UID_1 SELF_LOG_ENABLED"
    for key in $REQUIRED; do
        v="$(env_val "$key")"
        if [ -z "$v" ]; then
            error ".env: $key is empty or missing"
        else
            case "$key" in
                *PW*|*PASSWORD*|*TOKEN*|*KEY*|*SECRET*) ok ".env: $key set (masked)" ;;
                *) ok ".env: $key=$v" ;;
            esac
        fi
    done

    # The writer credential is only consumed when self-logging is on; when off
    # its absence is informational, never a warning (dead-key doctrine).
    SELF_LOG_V="$(env_val SELF_LOG_ENABLED)"
    if [ "$SELF_LOG_V" = "true" ]; then
        for key in PG_WRITER_USER PG_WRITER_PASSWORD; do
            [ -n "$(env_val "$key")" ] || error ".env: $key empty while SELF_LOG_ENABLED=true — heartbeat writes will fail every interval"
        done
    else
        info "SELF_LOG_ENABLED=$SELF_LOG_V — writer credential not required (PG_WRITER_* unchecked)"
    fi

    # db/pg-pool.js falls back PGHOST -> PG_HOST: an empty PGHOST with a stray
    # PG_HOST present would silently retarget the dashboard (monday's Azure
    # fallback lesson — this .env has no PG_HOST today; guard against drift).
    if [ -z "$(env_val PGHOST)" ] && [ -n "$(env_val PG_HOST)" ]; then
        error ".env: PGHOST empty while PG_HOST is set — pg-pool.js would silently target PG_HOST ($(env_val PG_HOST))"
    fi

    grep -q "^RUN_USER=" .env && warn ".env: RUN_USER must not be pinned here — entrypoint.sh defaults to svc; dev runs pass it on the command line"

    # Identity-vs-location: the dev/release split lives in three keys, and a
    # dev-identity .env inside the release copy IS the "dev runs in prod"
    # failure (wrong compose project would recreate the wrong container).
    APP_NAME_V="$(env_val APP_NAME)"
    CPN_V="$(env_val COMPOSE_PROJECT_NAME)"; HOST_PORT_V="$(env_val HOST_PORT)"
    if [ "$(pwd)" = "/opt/apps/${APP_NAME_V}" ]; then
        [ "$USER_ID_V" = "svc" ]          || error "release copy but USER_ID=$USER_ID_V (expected svc) — was build-release.sh bypassed?"
        [ "$CPN_V" = "ops-dashboard" ]    || error "release copy but COMPOSE_PROJECT_NAME=$CPN_V (expected ops-dashboard)"
        [ "$HOST_PORT_V" = "8080" ]       || error "release copy but HOST_PORT=$HOST_PORT_V (expected 8080)"
        RELEASE_SHA_V="$(env_val RELEASE_SHA)"
        if [ -n "$RELEASE_SHA_V" ]; then ok "RELEASE_SHA=$RELEASE_SHA_V (stamped by build-release.sh)"
        else error "release copy but RELEASE_SHA missing — runs would record 'dev-tree'"; fi
    else
        [ "$USER_ID_V" != "svc" ]              || error "dev tree but USER_ID=svc — dev runs must use your own identity"
        [ "$CPN_V" != "ops-dashboard" ]        || error "dev tree but COMPOSE_PROJECT_NAME=ops-dashboard — a dev 'up -d' would RECREATE the production container"
        [ "$HOST_PORT_V" != "8080" ]           || warn "dev tree but HOST_PORT=8080 — will collide with the production publish"
        grep -q '^RELEASE_SHA=' .env && error "dev tree but RELEASE_SHA present — never set it by hand (runs must record 'dev-tree')"
        ok "dev-tree identity ($USER_ID_V / $CPN_V / :$HOST_PORT_V)"
    fi
fi

# ---------------------------------------------------------------- 5. app files
section "Application files"
for f in index.js server.js package.json Dockerfile entrypoint.sh docker-compose.yaml build.sh build-release.sh; do
    if [ -f "$f" ]; then ok "$f present"; else error "$f missing"; fi
done
for d in config db lib public utils/logger; do
    if [ -d "$d" ]; then ok "$d/ present"; else error "$d/ missing"; fi
done
if [ -e utils/.git ]; then error "utils/.git exists — utils must be app-owned, not a nested repo"; else ok "utils/ is app-owned (no nested .git)"; fi

# --------------------------------------------------------------------- 6. deps
section "Dependencies"
if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; then
    ok "root node_modules present ($(ls node_modules | wc -l) entries)"
else
    error "root node_modules missing or empty — run: bash build.sh"
fi

# ------------------------------------------------- 7. external services (AUTH)
section "External services (authenticated checks)"

# The Postgres auth test MUST run from a sibling container on pg_net, never
# via `docker exec <pg_container> psql`: pg_hba trusts local and loopback, so
# an exec'd psql succeeds with a deliberately WRONG password (that path hid a
# rotated password for three weeks on a sibling app). This mirrors how the app
# connects (db/pg-pool.js): PG_SSLMODE from .env. Both roles are verified
# AUTH-ONLY with SELECT 1 — the writer's log function is NEVER executed here,
# because that would insert a real heartbeat row into the production record.
PGHOST_V="$(env_val PGHOST)"; PGPORT_V="$(env_val PGPORT)"
PGDATABASE_V="$(env_val PGDATABASE)"

pg_auth_check() {
    # $1 = role label, $2 = user, $3 = password
    if [ -z "$3" ]; then
        error "$1: password empty in .env — cannot verify PostgreSQL authentication"
        return
    fi
    if ! docker image inspect postgres:16 >/dev/null 2>&1; then
        # An unverified check must never look like a passing one.
        warn "postgres:16 image absent — PostgreSQL auth ($1) NOT verified"
        info "Fix: docker pull postgres:16   (needed only for this check)"
        return
    fi
    local ssl_args=()
    case "$PG_SSLMODE_V" in
        verify-ca|verify-full)
            ssl_args=(-e PGSSLROOTCERT=/ssl.crt -v "$PG_SSL_PATH_V":/ssl.crt:ro) ;;
    esac
    local out
    out=$(docker run --rm --network pg_net \
        -e PGPASSWORD="$3" -e PGSSLMODE="$PG_SSLMODE_V" \
        -e PGCONNECT_TIMEOUT=10 \
        "${ssl_args[@]}" \
        postgres:16 \
        psql -h "$PGHOST_V" -p "$PGPORT_V" -U "$2" -d "$PGDATABASE_V" \
             -tAc "SELECT 'ok'" 2>&1)
    if [ "$(echo "$out" | tail -1 | tr -d '[:space:]')" = "ok" ]; then
        ok "PostgreSQL auth OK as $2 ($1, sibling-container SSL connection)"
    elif echo "$out" | grep -qi "password authentication failed\|no password supplied"; then
        error "PostgreSQL rejected $1 password from .env — likely a rotated credential"
        info "Fix: rotation path is /root/${2}_pw + db/setup-*-role.sql (see rotate-envs script notes); update BOTH copies' .env (dev clone + release)"
    elif echo "$out" | grep -qi "certificate\|SSL"; then
        error "PostgreSQL SSL failure ($1): $(echo "$out" | head -2)"
    else
        error "PostgreSQL check failed ($1): $(echo "$out" | head -2)"
    fi
}

pg_auth_check "read-only role" "$(env_val PGUSER)" "$(env_val PGPASSWORD)"
if [ "$(env_val SELF_LOG_ENABLED)" = "true" ]; then
    pg_auth_check "writer role" "$(env_val PG_WRITER_USER)" "$(env_val PG_WRITER_PASSWORD)"
else
    info "writer role unchecked (SELF_LOG_ENABLED != true)"
fi

# ----------------------------------------------- release currency (fleet-wide)
# FLEET-FINDINGS §4.1: two sessions shipped a release believing it contained
# work that existed only in the dev tree. Currency is a continuous property —
# check it on every preflight, from either copy.
section "Release currency"
if [ -d .git ]; then
    REL_DIR="/opt/apps/$(basename "$(pwd)")"
    REL_SHA="$(grep '^RELEASE_SHA=' "$REL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\"[:space:]")"
    HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)"
    if [ -z "$HEAD_SHA" ]; then
        warn "cannot read git HEAD here — release currency not checked"
    elif [ -z "$REL_SHA" ]; then
        warn "no RELEASE_SHA at $REL_DIR/.env — release copy missing or never released"
    elif [ "$(git rev-parse --quiet --verify "$REL_SHA^{commit}" 2>/dev/null)" = "$HEAD_SHA" ]; then
        ok "release copy is current (RELEASE_SHA=$REL_SHA = HEAD)"
        [ -n "$(git status --porcelain 2>/dev/null)" ] && info "note: this tree has uncommitted changes — they are in NO release"
    else
        BEHIND="$(git rev-list --count "$REL_SHA..HEAD" 2>/dev/null)"
        if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 0 ] 2>/dev/null; then
            warn "release copy is $BEHIND commit(s) behind HEAD (RELEASE_SHA=$REL_SHA) — /opt/apps runs OLD code until build-release.sh"
        else
            warn "deployed RELEASE_SHA=$REL_SHA is not an ancestor of HEAD (rebase? branch switch?) — verify what /opt/apps is running"
        fi
    fi
else
    REL_SHA="$(env_val RELEASE_SHA)"
    if [ -n "$REL_SHA" ]; then
        ok "release copy stamped RELEASE_SHA=$REL_SHA"
    else
        error "no RELEASE_SHA in this .env — this copy was not produced by build-release.sh"
    fi
fi

# ------------------------------------------------------------------ 8. summary
section "Summary"
echo "  $OKS ok, $WARNINGS warnings, $ERRORS errors"
if [ "$ERRORS" -gt 0 ]; then
    echo "  RESULT: FAIL"
    exit 1
fi
[ "$WARNINGS" -gt 0 ] && echo "  RESULT: PASS (with warnings — a clean run should report zero)"
[ "$WARNINGS" -eq 0 ] && echo "  RESULT: PASS"
# Explicit success exit: without it the script's status is the last [ ] test,
# which is FALSE on a warnings-only run — the exact bug found in monday's copy.
exit 0
