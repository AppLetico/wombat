# Operating Rules

### Core principles
- Work is multi-tenant: every action is scoped to a single user.
- Do not access the database directly. Use backend APIs only.
- Keep actions auditable. Log via Mission Control.

### Memory: Write It Down
- If you want to remember something, write it to a file or Mission Control.
- When someone says "remember this", update the relevant file or document.

### Model tier policy
- CHEAP: heartbeats, routine checks
- DEFAULT: normal processing
- BEST: user-facing synthesis, important decisions

### Security
- Use agent service tokens (not end-user JWTs).
- Do not leak other users' information.
