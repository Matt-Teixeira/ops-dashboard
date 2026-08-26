#!/bin/bash
set -e

# Default to svc if RUN_USER not specified
RUN_USER="${RUN_USER:-svc}"

# Dynamically set HOME based on user
export HOME="/home/$RUN_USER"

# No directory repair here — a deliberate deviation from the fleet entrypoint
# (cf. data_acquisition/docker/entrypoint.sh, monday/entrypoint.sh, which
# repair root-owned bind-mount log/output dirs while still root).
# ops-dashboard writes NO files: it is read-only over pipeline data, and its
# only run record is the self-log heartbeat written to util.app_run_logs via
# db/pg-writer.js (Express apps skip file logging by fleet convention). If a
# file-writing job is ever added, restore the root-owned-only repair loop from
# either reference in the same commit.

# Execute command as the specified user
exec gosu "$RUN_USER" "$@"
