# bmfp: the Be-Music Fingerprint in portable C. Plain make, no configure step.
#
#   make              library (build/libbmfp.a) and CLI (build/bmfp)
#   make test         run the test vectors
#   make std          compile as C99, C11, C17, C23 and C++, warnings as errors
#   make sanitize     run the tests under AddressSanitizer and UndefinedBehaviorSanitizer
#   make wasm         bare WebAssembly module (build/bmfp.wasm) and its smoke test
#   make check        all of the above
#
# CC, CXX, WASM_CC and WASM_LDFLAGS can be overridden, e.g. `make wasm WASM_CC=/opt/homebrew/opt/llvm/bin/clang`.

CC ?= cc
CXX ?= c++
WASM_CC ?= clang
WASM_LDFLAGS ?=
NODE ?= node

BUILD := build
CORE := src/context.c src/bigint.c src/rational.c src/binary64.c src/sha256.c src/bmfp.c
HOSTED := $(CORE) src/alloc_libc.c
HEADERS := include/bmfp.h $(wildcard src/*.h)

WARNINGS := -Wall -Wextra -Wpedantic -Wshadow -Wstrict-prototypes -Wmissing-prototypes -Wcast-qual -Wundef -Werror
CFLAGS ?= -O2
ALL_CFLAGS := -std=c99 $(WARNINGS) -Iinclude -Isrc $(CFLAGS)

WASM_EXPORTS := bmfp_version bmfp_algorithm bmfp_status_text bmfp_sha256_hex bmfp_wasm_alloc bmfp_wasm_free

.PHONY: all test std sanitize wasm check clean

all: $(BUILD)/libbmfp.a $(BUILD)/bmfp

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/libbmfp.a: $(HOSTED) $(HEADERS) | $(BUILD)
	rm -f $@ $(BUILD)/*.o
	for source in $(HOSTED); do $(CC) $(ALL_CFLAGS) -c $$source -o $(BUILD)/$$(basename $$source .c).o || exit 1; done
	ar rcs $@ $(addprefix $(BUILD)/,$(notdir $(HOSTED:.c=.o)))

$(BUILD)/bmfp: cli/main.c $(BUILD)/libbmfp.a
	$(CC) $(ALL_CFLAGS) cli/main.c $(BUILD)/libbmfp.a -o $@

$(BUILD)/bmfp-test: tests/test_main.c $(HOSTED) $(HEADERS) | $(BUILD)
	$(CC) $(ALL_CFLAGS) tests/test_main.c $(HOSTED) -o $@

test: $(BUILD)/bmfp-test $(BUILD)/bmfp
	$(BUILD)/bmfp-test tests/vectors
	test "$$(printf abc | $(BUILD)/bmfp sha256)" = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

std:
	for standard in c99 c11 c17; do \
	  $(CC) -std=$$standard $(WARNINGS) -Iinclude -Isrc -fsyntax-only $(HOSTED) tests/test_main.c cli/main.c || exit 1; \
	done
	if $(CC) -std=c2x -fsyntax-only -x c /dev/null 2>/dev/null; then \
	  $(CC) -std=c2x $(WARNINGS) -Iinclude -Isrc -fsyntax-only $(HOSTED) cli/main.c; \
	else echo "skipping C23: $(CC) has no -std=c2x"; fi
	$(CXX) -x c++ -std=c++11 -Wall -Wextra -Wpedantic -Werror -Wno-deprecated -Iinclude -Isrc -fsyntax-only $(HOSTED)

sanitize: | $(BUILD)
	$(CC) -std=c99 $(WARNINGS) -Iinclude -Isrc -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer \
	  -fno-sanitize-recover=all tests/test_main.c $(HOSTED) -o $(BUILD)/bmfp-test-sanitize
	$(BUILD)/bmfp-test-sanitize tests/vectors

$(BUILD)/bmfp.wasm: $(CORE) src/wasm.c $(HEADERS) | $(BUILD)
	$(WASM_CC) --target=wasm32-unknown-unknown -std=c99 $(WARNINGS) -O2 -nostdlib -ffreestanding -Iinclude -Isrc \
	  -Wl,--no-entry $(addprefix -Wl$(comma)--export=,$(WASM_EXPORTS)) $(WASM_LDFLAGS) $(CORE) src/wasm.c -o $@

comma := ,

wasm: $(BUILD)/bmfp.wasm
	$(NODE) tests/wasm_smoke.mjs $(BUILD)/bmfp.wasm

check: test std sanitize wasm

clean:
	rm -rf $(BUILD)
