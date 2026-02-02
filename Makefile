# Wombat - common targets for dev and CI
# Use: make setup (first time), make dev, make workspace, make test, etc.

.PHONY: install dev build test setup workspace clean conformance

install:
	npm install

# One-command setup: install deps, copy .env.example → .env (if missing), scaffold workspace
setup: install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; else echo ".env already exists (skipped)"; fi
	@$(MAKE) workspace
	@echo ""
	@echo "Setup done. Next: edit .env (BACKEND_URL, AGENT_JWT_SECRET, LLM keys), then run: make dev"

dev:
	npm run dev

build:
	npm run build

test:
	npm test

# Create a workspace from the built-in template (./workspace, or set WOMBAT_WORKSPACE)
workspace:
	npm run init-workspace

# Overwrite existing workspace files
workspace-force:
	WOMBAT_WORKSPACE=$${WOMBAT_WORKSPACE:-./workspace} npm run init-workspace -- --force

clean:
	rm -rf dist node_modules/.cache

# Run control-plane conformance against BACKEND_URL (requires AGENT_TOKEN)
conformance:
	npm run conformance
