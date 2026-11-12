#!/usr/bin/env bash
# Prune old images from a Container Registry repository.
#
# Keeps the newest KEEP tagged images (by push time), anything carrying a tag
# listed in PROTECT_TAGS, every manifest a kept image index references (its
# platform image and attestation — read from the index itself, so a protected
# image older than the newest KEEP stays pullable), and, as a backstop, every
# manifest pushed at or after the oldest of the newest KEEP. Everything else is
# deleted by digest, which is what actually frees storage — untagging alone
# does not.
#
# Usage: acr-prune.sh <registry> <repository> [--apply]
#   KEEP=10 PROTECT_TAGS="dev-latest dev-abc12345" SUBSCRIPTION=<id>
# Without --apply it only prints what it would delete.
set -euo pipefail

REGISTRY="${1:?registry name}"
REPO="${2:?repository}"
APPLY="${3:-}"
KEEP="${KEEP:-10}"
PROTECT_TAGS="${PROTECT_TAGS:-}"
SUB_ARGS=()
[ -n "${SUBSCRIPTION:-}" ] && SUB_ARGS=(--subscription "$SUBSCRIPTION")

LIST=$(az acr manifest list-metadata "${SUB_ARGS[@]}" -r "$REGISTRY" -n "$REPO" \
  --orderby time_desc -o json --only-show-errors)

DELETE=$(KEEP="$KEEP" PROTECT_TAGS="$PROTECT_TAGS" REGISTRY="$REGISTRY" REPO="$REPO" \
  SUB="${SUBSCRIPTION:-}" python3 -c '
import json, os, subprocess, sys
m = json.load(sys.stdin)
keep = int(os.environ["KEEP"]); protect = set(os.environ["PROTECT_TAGS"].split())
tagged = [x for x in m if x.get("tags")]
kept = tagged[:keep] + [x for x in tagged if protect & set(x["tags"])]
if not kept:
    sys.exit("refusing to prune: nothing would be kept")
missing = protect - {t for x in tagged for t in x["tags"]}
if missing:
    print("warning: protected tag(s) not found: " + " ".join(sorted(missing)), file=sys.stderr)
cutoff = min(x["lastUpdateTime"] for x in tagged[:keep])
kept_digests = {x["digest"] for x in kept}
sub = ["--subscription", os.environ["SUB"]] if os.environ["SUB"] else []
for digest in sorted(kept_digests):
    # An image index names its platform manifests and attestations; deleting
    # one of those would leave the kept tag unpullable. Fail closed: if the
    # index cannot be read, nothing is deleted.
    out = subprocess.run(
        ["az", "acr", "manifest", "show", *sub, "-r", os.environ["REGISTRY"],
         "-n", os.environ["REPO"] + "@" + digest, "-o", "json", "--only-show-errors"],
        capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("refusing to prune: could not read manifest " + digest[7:19] + ": " + out.stderr.strip())
    for child in json.loads(out.stdout).get("manifests") or []:
        kept_digests.add(child["digest"])
for x in m:
    if x["digest"] in kept_digests or x["lastUpdateTime"] >= cutoff:
        continue
    print(x["digest"], ",".join(x.get("tags") or []) or "-")
' <<<"$LIST")

COUNT=$(printf '%s' "$DELETE" | grep -c . || true)
echo "Repository ${REGISTRY}/${REPO}: $(python3 -c 'import json,sys;print(len(json.load(sys.stdin)))' <<<"$LIST") manifests, ${COUNT} to delete (keep newest ${KEEP} tagged + ${PROTECT_TAGS:-none})."
[ "$COUNT" -eq 0 ] && exit 0

if [ "$APPLY" != "--apply" ]; then
  printf '%s\n' "$DELETE" | head -20
  [ "$COUNT" -gt 20 ] && echo "… and $((COUNT - 20)) more"
  echo "Dry run. Re-run with --apply to delete."
  exit 0
fi

while read -r DIGEST TAGS; do
  echo "Deleting ${DIGEST:7:12} (${TAGS})"
  az acr repository delete "${SUB_ARGS[@]}" -n "$REGISTRY" \
    --image "${REPO}@${DIGEST}" --yes --only-show-errors \
    || echo "  could not delete ${DIGEST:7:12} (already gone or still referenced)"
done <<<"$DELETE"
