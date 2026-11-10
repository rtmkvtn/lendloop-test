#!/bin/sh
# Runs on every start; safe to repeat because imports overwrite by id. Import
# unpublishes a workflow, so every trigger workflow is published again after it.
set -eu
umask 077
node /opt/lendloop/render.cjs /opt/lendloop/credentials.template.json /tmp/creds.json
n8n import:credentials --input=/tmp/creds.json
rm -f /tmp/creds.json
# Workflows can't read env, so ${VAR} placeholders (the alert address) are filled in here.
rm -rf /tmp/workflows
mkdir -p /tmp/workflows
for f in /opt/lendloop/workflows/*.json; do
  node /opt/lendloop/render.cjs "$f" "/tmp/workflows/$(basename "$f")"
done
n8n import:workflow --separate --input=/tmp/workflows
rm -rf /tmp/workflows
# n8n only calls a published Error Workflow ("is not active and cannot be executed").
for id in llNotifyWf000001 llReminderWf0001 llErrorWf0000001; do
  n8n publish:workflow --id="$id"
done
exec n8n start
