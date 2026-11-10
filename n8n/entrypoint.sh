#!/bin/sh
# Runs on every start; safe to repeat because imports overwrite by id. Import
# unpublishes a workflow, so every trigger workflow is published again after it.
set -eu
umask 077
node /opt/lendloop/render.cjs /opt/lendloop/credentials.template.json /tmp/creds.json
n8n import:credentials --input=/tmp/creds.json
rm -f /tmp/creds.json
n8n import:workflow --separate --input=/opt/lendloop/workflows
for id in llNotifyWf000001 llReminderWf0001; do
  n8n publish:workflow --id="$id"
done
exec n8n start
