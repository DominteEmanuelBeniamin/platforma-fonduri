#!/usr/bin/env bash
# Publică issue-urile draft din acest director pe GitHub.
# A se rula DOAR după aprobare. Idempotent la nivel de etichete, NU la nivel de issue-uri
# (rularea de două ori creează duplicate).
set -euo pipefail
cd "$(dirname "$0")"

REPO="DominteEmanuelBeniamin/platforma-fonduri"

echo "== Creez etichetele lipsă =="
gh label create "ux"       --repo "$REPO" --color "1D76DB" --description "Interfață și experiență utilizator" 2>/dev/null || echo "  ux: există deja"
gh label create "security" --repo "$REPO" --color "B60205" --description "Vizibilitate date și permisiuni"    2>/dev/null || echo "  security: există deja"
gh label create "infra"    --repo "$REPO" --color "5319E7" --description "Infrastructură (cron, email, storage)" 2>/dev/null || echo "  infra: există deja"
gh label create "audit"    --repo "$REPO" --color "0E8A16" --description "Jurnalizare în audit"               2>/dev/null || echo "  audit: există deja"

echo
echo "== Creez issue-urile =="
# Convenție: după publicare, draft-ul se ȘTERGE din acest director
# (issue-urile #44, #45, #46 au fost publicate așa). Ce e aici = nepublicat.
for f in [0-9][0-9]-*.md; do
  [ "$f" = "00-INDEX.md" ] && continue
  labels=$(sed -n '1s/^<!-- labels: \(.*\) -->$/\1/p' "$f")
  title=$(sed -n '2s/^# //p' "$f")

  if [ -z "$title" ]; then
    echo "SAR: $f (nu am găsit titlul pe linia 2)" >&2
    continue
  fi

  body_file=$(mktemp)
  tail -n +3 "$f" > "$body_file"

  echo "-> $title"
  gh issue create --repo "$REPO" --title "$title" --body-file "$body_file" ${labels:+--label "$labels"}

  rm -f "$body_file"
done

echo
echo "Gata. Verifică: https://github.com/$REPO/issues"
