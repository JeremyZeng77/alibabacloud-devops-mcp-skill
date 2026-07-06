from __future__ import annotations

import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "0.0.0.0"
PORT = 18790
SCRIPT_DIR = Path(__file__).resolve().parent
COMPILE_SCRIPT = str(SCRIPT_DIR / "compile_projects_data.py")

STATE_DIR = Path(r"C:\Users\DELL\.openclaw\workspace-gemma-chat\state\project-bridge")
CAPTURE_FILE = STATE_DIR / "page-captures.jsonl"
LATEST_FILE = STATE_DIR / "latest-page.json"

STATE_DIR.mkdir(parents=True, exist_ok=True)


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return json_response(self, 200, {"ok": True, "service": "project-bridge", "time": datetime.now().isoformat()})
        if parsed.path == "/compile":
            try:
                import subprocess
                import sys
                import os
                kwargs = {"capture_output": True, "text": True, "encoding": 'utf-8'}
                if os.name == 'nt':
                    kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
                res = subprocess.run([sys.executable, COMPILE_SCRIPT], **kwargs)
                if res.returncode == 0:
                    # Automatically commit and push changed data files to GitHub to trigger online Pages deployment
                    try:
                        # Add compiled JSON, weekly reports, and history db
                        subprocess.run(["git", "add", "projects_data.json", "weekly_reports.md", "projects_history.db"], **kwargs)
                        # Check if there are changes to commit
                        diff_res = subprocess.run(["git", "diff", "--quiet"], **kwargs)
                        diff_staged_res = subprocess.run(["git", "diff", "--staged", "--quiet"], **kwargs)
                        if diff_res.returncode != 0 or diff_staged_res.returncode != 0:
                            subprocess.run(["git", "commit", "-m", "chore: auto-sync DevOps progress data via local bridge"], **kwargs)
                            subprocess.run(["git", "pull", "--rebase", "origin", "main"], **kwargs)
                            subprocess.run(["git", "push", "origin", "main"], **kwargs)
                    except Exception as git_err:
                        print(f"Git push failed: {git_err}")
                    
                    return json_response(self, 200, {"ok": True, "message": "Compiled and pushed successfully", "output": res.stdout})
                else:
                    return json_response(self, 500, {"ok": False, "error": res.stderr, "output": res.stdout})
            except Exception as e:
                return json_response(self, 500, {"ok": False, "error": str(e)})
        if parsed.path == "/generate_weekly":
            try:
                import subprocess
                import sys
                import os
                kwargs = {"capture_output": True, "text": True, "encoding": 'utf-8'}
                if os.name == 'nt':
                    kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
                res = subprocess.run([sys.executable, COMPILE_SCRIPT, "--generate-weekly"], **kwargs)
                if res.returncode == 0:
                    return json_response(self, 200, {"ok": True, "message": "Weekly report generated successfully", "output": res.stdout})
                else:
                    return json_response(self, 500, {"ok": False, "error": res.stderr, "output": res.stdout})
            except Exception as e:
                return json_response(self, 500, {"ok": False, "error": str(e)})
        if parsed.path == "/latest":
            if not LATEST_FILE.exists():
                return json_response(self, 404, {"ok": False, "error": "no-latest-capture"})
            payload = json.loads(LATEST_FILE.read_text(encoding="utf-8"))
            return json_response(self, 200, {"ok": True, "capture": payload})
        if parsed.path == "/status":
            latest = None
            if LATEST_FILE.exists():
                latest = json.loads(LATEST_FILE.read_text(encoding="utf-8"))
            capture_count = 0
            if CAPTURE_FILE.exists():
                with CAPTURE_FILE.open("r", encoding="utf-8") as f:
                    capture_count = sum(1 for _ in f)
            payload = {
                "ok": True,
                "service": "project-bridge",
                "time": datetime.now().isoformat(),
                "latestCapture": latest,
                "captureCount": capture_count,
                "paths": {
                    "latest": str(LATEST_FILE),
                    "captures": str(CAPTURE_FILE),
                },
            }
            return json_response(self, 200, payload)
        return json_response(self, 404, {"ok": False, "error": "not-found"})

    def do_POST(self):
        if self.path != "/page":
            return json_response(self, 404, {"ok": False, "error": "not-found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            return json_response(self, 400, {"ok": False, "error": f"bad-json: {exc}"})

        envelope = {
            "receivedAt": datetime.now().isoformat(),
            **payload,
        }
        CAPTURE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with CAPTURE_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(envelope, ensure_ascii=False) + "\n")
        LATEST_FILE.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        
        # Trigger compile asynchronously
        try:
            import subprocess
            import sys
            import os
            kwargs = {}
            if os.name == 'nt':
                kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            subprocess.Popen([sys.executable, COMPILE_SCRIPT], **kwargs)
        except Exception:
            pass
            
        return json_response(self, 200, {"ok": True, "stored": str(CAPTURE_FILE), "latest": str(LATEST_FILE)})

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Project Bridge server listening on http://{HOST}:{PORT}")
    server.serve_forever()
