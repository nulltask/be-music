#!/bin/sh
# Builds and runs the host test of the jig's core with the system C compiler.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic -I"$here/../src" \
  "$here/../src/jig_core.c" "$here/jig_core_test.c" -o "$out/jig_core_test"
"$out/jig_core_test"
