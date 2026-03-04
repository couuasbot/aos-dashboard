# Smoke Test

## Overview
The smoke test validates that the AOS Dashboard builds, tests pass, and the application renders correctly.

## Running the Smoke Test

```bash
npm run smoke
```

This runs the `smoke-test.sh` script which:

1. **Runs tests** - Executes `npm test` across all workspaces
2. **Builds the project** - Runs `npm run build` for all packages and apps
3. **Starts API server** - Launches the API in development mode
4. **Starts Web server** - Launches the web app with Vite
5. **Captures screenshot** - Takes a screenshot of the homepage

## Output Artifacts

The smoke test outputs:
- `homepage-screenshot-v0.4.png` - Screenshot of the rendered homepage

Location: `/home/ubuntu/.openclaw/workspace-god/artifacts/aos-tasks/aosdash-v0.4-003/run_*/`

## Exit Behavior

- **Exit code 0** - All steps passed (tests, build, screenshot captured)
- **Exit code non-zero** - Any step failed (test failure, build error, missing screenshot)

The script uses `set -e` to fail fast on any error.