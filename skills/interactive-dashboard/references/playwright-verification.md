# Playwright Verification Template

Use this template for the Tier 2 browser verification step described in SKILL.md.

Write `verify.py` into the same directory as `index.html` (or `start.sh` for Complex tier). Run it after the server is already listening on its port.

## Simple Tier — `verify.py`

```python
#!/usr/bin/env python3
"""
Playwright verification script for simple-tier HTML dashboards.
Run after `python -m http.server 8050` is already listening.

Usage: python verify.py
Exit code 0 = pass, non-zero = fail (details printed to stdout).
"""
import sys

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("Playwright not available — skipping browser verification")
    sys.exit(0)

PORT = 8050
URL = f"http://localhost:{PORT}/"

def run():
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Capture JS runtime errors
        js_errors = []
        page.on("pageerror", lambda exc: js_errors.append(str(exc)))

        # 1. Load the page
        try:
            page.goto(URL, wait_until="networkidle", timeout=15_000)
        except PlaywrightTimeout:
            errors.append("Page did not finish loading within 15 seconds")
            browser.close()
            return errors

        # 2. Check for JS errors
        if js_errors:
            errors.append(f"JavaScript errors detected:\n  " + "\n  ".join(js_errors))

        # 3. Verify page has meaningful content (not blank)
        body_text = page.locator("body").inner_text()
        if len(body_text.strip()) < 20:
            errors.append("Page body appears blank (less than 20 chars of text)")

        # 4. Check charts rendered — Plotly and Chart.js leave DOM markers
        plotly_charts = page.locator(".plotly, .js-plotly-plot").count()
        chartjs_canvases = page.locator("canvas").count()
        if plotly_charts == 0 and chartjs_canvases == 0:
            # Not an error by itself — some dashboards use other libs
            print("Note: no Plotly or Chart.js elements detected (may use another library)")

        # 5. Click the first interactive button (if present) and check no crash
        buttons = page.locator("button")
        if buttons.count() > 0:
            try:
                buttons.first.click(timeout=3_000)
                page.wait_for_timeout(500)
                # Re-check JS errors after interaction
                if js_errors:
                    errors.append(f"JavaScript errors after button click:\n  " + "\n  ".join(js_errors))
            except PlaywrightTimeout:
                errors.append("Primary button click timed out")

        # 6. Screenshot for visual confirmation
        page.screenshot(path="verify-screenshot.png", full_page=True)
        print("Screenshot saved to verify-screenshot.png")

        browser.close()

    return errors


if __name__ == "__main__":
    issues = run()
    if issues:
        print("VERIFICATION FAILED:")
        for issue in issues:
            print(f"  - {issue}")
        sys.exit(1)
    else:
        print("VERIFICATION PASSED — no JS errors, page loaded, charts detected")
        sys.exit(0)
```

## Complex Tier — `verify.py`

For Complex tier (FastAPI backend + Vite/React or Dockerized app), extend the script to also verify API responses:

```python
#!/usr/bin/env python3
"""
Playwright verification script for complex-tier dashboards.
Run after start.sh has confirmed the server is healthy.
"""
import sys
import json

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("Playwright not available — skipping browser verification")
    sys.exit(0)

PORT = 8050
URL = f"http://localhost:{PORT}/"

def run():
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        js_errors = []
        page.on("pageerror", lambda exc: js_errors.append(str(exc)))

        # Track API responses
        api_responses = {}
        def capture_response(response):
            if "/api/" in response.url:
                try:
                    api_responses[response.url] = response.status
                except Exception:
                    pass
        page.on("response", capture_response)

        # 1. Load page
        try:
            page.goto(URL, wait_until="networkidle", timeout=20_000)
        except PlaywrightTimeout:
            errors.append("Page did not load within 20 seconds")
            browser.close()
            return errors

        # 2. JS errors
        if js_errors:
            errors.append("JavaScript errors:\n  " + "\n  ".join(js_errors))

        # 3. API health — all /api/ calls should return 2xx
        failed_apis = {url: status for url, status in api_responses.items() if status >= 400}
        if failed_apis:
            errors.append(f"API errors: {json.dumps(failed_apis, indent=2)}")

        # 4. Charts rendered
        plotly_count = page.locator(".js-plotly-plot").count()
        recharts_count = page.locator(".recharts-wrapper").count()
        canvas_count = page.locator("canvas").count()
        if plotly_count == 0 and recharts_count == 0 and canvas_count == 0:
            print("Note: no known chart library elements detected")

        # 5. Primary action
        buttons = page.locator("button")
        if buttons.count() > 0:
            try:
                buttons.first.click(timeout=3_000)
                page.wait_for_timeout(1_000)
                new_errors = [e for e in js_errors if e not in js_errors[:len(js_errors)]]
                if new_errors:
                    errors.append("New JS errors after button click:\n  " + "\n  ".join(new_errors))
            except PlaywrightTimeout:
                pass  # Button may not be clickable in current state — not fatal

        # 6. Screenshot
        page.screenshot(path="verify-screenshot.png", full_page=True)
        print("Screenshot saved to verify-screenshot.png")

        browser.close()

    return errors


if __name__ == "__main__":
    issues = run()
    if issues:
        print("VERIFICATION FAILED:")
        for issue in issues:
            print(f"  - {issue}")
        sys.exit(1)
    else:
        print("VERIFICATION PASSED")
        sys.exit(0)
```

## Usage Pattern in Workflow

```python
import subprocess, time

# Tier 1: syntax check (fast)
# ... (see SKILL.md Step 5 for the full snippet)

# Start server
proc = subprocess.Popen(["python", "-m", "http.server", "8050"],
                        cwd="work/dashboard", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)  # Give server time to bind

# Tier 2: Playwright browser test
result = subprocess.run(
    ["python", "work/dashboard/verify.py"],
    capture_output=True, text=True, timeout=60
)
print(result.stdout)
if result.returncode != 0:
    proc.terminate()
    raise RuntimeError(f"Browser verification failed:\n{result.stderr}")

# Server stays running — GetPreviewUrl reuses it
```

## What to Check for Your Dashboard

Customize the `verify.py` script for the specific dashboard:

| Dashboard type | Additional checks |
|---------------|------------------|
| Stock tracker | Ticker symbol appears in page title/heading |
| Sector heatmap | Treemap SVG element exists |
| Portfolio monitor | Holdings table has at least one row |
| Earnings tracker | Calendar or date elements visible |
| Multi-stock comparison | Multiple chart series in legend |
