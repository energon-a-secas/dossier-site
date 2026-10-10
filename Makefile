.DEFAULT_GOAL := help

PORT = 8899

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  make serve    Start dev server → http://localhost:$(PORT)"
	@echo "  make kill     Kill this project's HTTP server"
	@echo "  make check    Registry audit, every test, fixtures, and the byte scan"
	@echo "  make receipt  Build the one-file export and check it in a browser"
	@echo "  make schema   Regenerate schema.json and llms.txt, fail if changed"
	@echo ""

# ── Dev server ────────────────────────────────────────────────────────────────
# scripts/serve.py is http.server plus Cache-Control: no-cache; a plain
# http.server sends only Last-Modified, so browsers keep stale ES modules after
# edits. Falls back to plain http.server outside the monorepo.
.PHONY: serve
serve:
	@echo "Serving → http://localhost:$(PORT)"
	@if [ -f ../../scripts/serve.py ]; then python3 ../../scripts/serve.py $(PORT); else python3 -m http.server $(PORT); fi

# ── Kill ──────────────────────────────────────────────────────────────────────
.PHONY: kill
kill:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on port $(PORT)" || echo "No server running on port $(PORT)"

# ── Validation ────────────────────────────────────────────────────────────────
# `node --test tests/` runs the whole directory on purpose. The first version
# of this target named each file, so a test added later was silently never run,
# which is the same drift the block registry exists to prevent.
.PHONY: check
check:
	@echo "Registry audit, then every test in tests/ ..."
	@node --test tests/*.test.mjs || exit 1
	@echo "Every fixture and template matches its declared expectation ..."
	@node scripts/check-fixtures.mjs || exit 1
	@echo "No em dash, and no control byte, in any file this project owns ..."
	@python3 scripts/no-stray-bytes.py || exit 1
	@echo "All checks passed"

# Regenerate the two artifacts and fail if either moved. This project is not
# its own git repo yet, and the paths are ignored by the root repo, so a
# `git diff` check here reports clean no matter what. Compare hashes instead.
# The export receipt. Separate from `check` because it needs a browser, and
# `check` has to run anywhere. Every way the one-file export fails is invisible
# from the app, so this opens the bytes a recipient would get, with the network
# cut, and checks what they would see.
.PHONY: receipt
receipt:
	@node scripts/check-standalone.mjs

.PHONY: schema
schema:
	@echo "Regenerating schema.json, llms.txt and SKILL.md ..."
	@before=$$(shasum schema.json llms.txt SKILL.md 2>/dev/null | shasum | cut -d' ' -f1); \
	node bin/gen-schema.mjs && node bin/gen-llms.mjs; \
	after=$$(shasum schema.json llms.txt SKILL.md 2>/dev/null | shasum | cut -d' ' -f1); \
	if [ "$$before" = "$$after" ]; then \
		echo "  up to date with the registry"; \
	else \
		echo "  regenerated: the committed copies were stale, commit them"; exit 1; \
	fi
