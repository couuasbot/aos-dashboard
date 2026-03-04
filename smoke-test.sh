#!/bin/bash
# AOS Dashboard v0.3 Release Smoke Script
# Runs: npm test, npm build, starts api+web locally, captures homepage screenshot
# Output: artifacts/homepage-screenshot.png

set -e

REPO_DIR="/home/ubuntu/.openclaw/workspace-god/repos/aos-dashboard"
OUTPUT_DIR="/home/ubuntu/.openclaw/workspace-god/artifacts/aos-tasks/aosdash-v0.3-003"
SCREENSHOT_PATH="$OUTPUT_DIR/homepage-screenshot.png"

mkdir -p "$OUTPUT_DIR"

echo "=== AOS Dashboard v0.3 Smoke Test ==="
cd "$REPO_DIR"

# Step 1: Run tests (must pass)
echo "[1/4] Running npm test..."
npm test

# Step 2: Build
echo "[2/4] Running npm build..."
npm run build

# Step 3: Start API (background)
echo "[3/4] Starting API server..."
cd "$REPO_DIR/apps/api"
npm run dev &
API_PID=$!
sleep 3

# Step 4: Start Web (background)
echo "[4/4] Starting Web server..."
pkill -f "vite" 2>/dev/null || true
sleep 1
cd "$REPO_DIR/apps/web"
npm run dev &
WEB_PID=$!
sleep 5

# Step 5: Capture screenshot using playwright CLI
echo "Capturing homepage screenshot..."
/home/ubuntu/.local/bin/playwright screenshot --wait-for-timeout 5000 http://localhost:5173 "$SCREENSHOT_PATH" 2>&1 || {
  echo "Trying with full page..."
  /home/ubuntu/.local/bin/playwright screenshot --full-page --wait-for-timeout 5000 http://localhost:5173 "$SCREENSHOT_PATH" 2>&1 || echo "Screenshot failed"
}

# Cleanup
echo "Cleaning up..."
kill $API_PID $WEB_PID 2>/dev/null || true

# Verify screenshot
if [ -f "$SCREENSHOT_PATH" ]; then
  echo "SUCCESS: Screenshot saved to $SCREENSHOT_PATH"
  ls -la "$SCREENSHOT_PATH"
else
  echo "WARNING: Screenshot not created"
fi

echo "=== Smoke test complete ==="