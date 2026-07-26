---
name: screenshots
description: Regenerate and validate the osr-editor documentation screenshots under docs/assets/screenshots/ — the capture harness, what the CI job does and does not prove, and the re-capture convention. Use when a PR changes a screenshotted surface or when working on the capture scripts.
---

# Documentation screenshots

- `cd frontend && npm run shots` regenerates every screenshot under `docs/assets/screenshots/`, both themes, in about twenty seconds. It needs the usual setup first (`uv sync`, `npm ci`, `npm run build`, `npx playwright install chromium`) — one command, not a one-command setup. The capture drives the real CLI and built frontend over the existing zero-network fixtures, exactly as the e2e suite does.
- The committed images are captured on the owner's machine. **CI never compares pixels**: the app uses system font stacks, so a macOS capture and CI's Linux rendering differ in every text-bearing shot, and a pixel gate would fail on cosmetic noise until the team learned to ignore it. Be precise about what the `screenshots` job does prove — a documented state that can no longer be reached, a renamed control a shot asserts on, or a shot whose test was deleted or skipped, all fail. A purely cosmetic change does not, and the committed image quietly ages.
- **A PR that changes a screenshotted surface re-captures in the same PR.** This is a convention the tooling does not enforce — it is in the changelog's class, not the generated-types class. The backstop is the fresh capture CI uploads as an artifact for a reviewer to eyeball.
- `scripts/check_screenshots.py` guards three directions: every referenced image exists, every committed image is referenced, and — with `--produced` — the harness still reports running exactly the shots the docs reference. It also holds the pair to identical dimensions and the directory to its weight budget. No committed image may contain a real, personal, or machine-specific path; the capture servers run under redirected `HOME`s at `/tmp/osr-editor-*` for exactly that reason, and dialogs whose path fields are not the subject are captured empty.
