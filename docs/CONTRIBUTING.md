# Contributing

## Setup

```bash
npm install
cp .env.example .env
```

## Dev workflow

```bash
npm run dev
```

## Tests

```bash
npm test          # Run all tests
npm test -- --watch  # Watch mode
```

### Test structure

- `src/lib/*.test.ts` - Unit tests for library modules
- `src/server/*.test.ts` - API endpoint tests

### Writing tests

```typescript
import { describe, expect, it, vi } from "vitest";

describe("MyModule", () => {
  it("does something", () => {
    expect(result).toBe(expected);
  });
});
```

## Style guidelines

- Keep modules small and focused
- Prefer explicit errors with clear messages
- **Avoid hardcoding project-specific names** in core logic
- Use workspace files for project-specific configuration
- Keep new config in `.env.example`

## Portability guidelines

Clasper is designed to be reusable across projects:

1. **No hardcoded domain logic** - Use workspace files for personas/rules
2. **Configurable via env vars** - Add new config to `.env.example`
3. **Generic defaults** - Fallbacks should be project-agnostic
4. **Document configuration** - Update docs when adding features

## Adding a new feature

1. Implement in `src/lib/` or `src/server/`
2. Add tests in the same directory (`.test.ts`)
3. Update `.env.example` if new config is needed
4. Update relevant docs (`API.md`, `WORKSPACE.md`, etc.)

## Adding a new script

1. Add your script in `src/scripts/`
2. Add a npm script in `package.json`
3. Add a CLI command in `src/cli.ts` if needed
4. Document it in `docs/QUICKSTART.md` and `docs/INTEGRATION.md`

## Workspace changes

If modifying the workspace loader:

1. Update `src/lib/workspace.ts`
2. Add tests in `src/lib/workspace.test.ts`
3. Update `docs/WORKSPACE.md` with new file specs
4. Update example workspaces in `docs/examples/`

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No project-specific hardcoding in core modules
- [ ] `.env.example` updated if new config added
- [ ] Docs updated if behavior changed
