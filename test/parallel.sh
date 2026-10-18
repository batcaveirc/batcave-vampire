#!/bin/sh
# Run every test file, N at a time (default 8). One after another takes 20+
# minutes; in parallel the suite finishes in about four. Each test binds its
# own random port, so they do not collide. Prints only the files that failed.
#   sh test/parallel.sh [jobs]
cd "$(dirname "$0")" || exit 1
JOBS=${1:-8}
OUT=$(mktemp -d)
ls *.js | grep -v '^run\.js$' | xargs -P "$JOBS" -I{} sh -c \
  'perl -e "alarm 240; exec @ARGV" node "$1" > "$2/$1.out" 2>&1 || echo "$1" >> "$2/failed"' _ {} "$OUT"
if [ -s "$OUT/failed" ]; then
  for t in $(sort "$OUT/failed"); do echo "FAIL $t: $(tail -1 "$OUT/$t.out")"; done
  echo "logs in $OUT"; exit 1
fi
echo "ALL PASS ($(ls *.js | grep -vc '^run\.js$') files)"
