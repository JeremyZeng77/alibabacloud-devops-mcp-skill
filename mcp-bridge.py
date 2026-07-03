import subprocess
import json
import os
import sys

# 1. Configure Yunxiao access parameters (prefer env variables)
YUNXIAO_TOKEN = os.environ.get("YUNXIAO_ACCESS_TOKEN", "YOUR_YUNXIAO_ACCESS_TOKEN")
ORG_ID = os.environ.get("YUNXIAO_ORG_ID", "YOUR_ORGANIZATION_ID")
PROJECT_ID = os.environ.get("YUNXIAO_PROJECT_ID", "YOUR_PROJECT_ID")

# 2. Spawn the MCP Server process (using npx)
env = os.environ.copy()
env["YUNXIAO_ACCESS_TOKEN"] = YUNXIAO_TOKEN

# Note: shell=True is required on Windows to look up npx properly
kwargs = {
    "stdin": subprocess.PIPE,
    "stdout": subprocess.PIPE,
    "stderr": subprocess.PIPE,
    "text": True,
    "env": env,
    "shell": True
}
if os.name == 'nt':
    kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

process = subprocess.Popen(
    ["npx", "-y", "alibabacloud-devops-mcp-server"],
    **kwargs
)

def send_msg(msg):
    process.stdin.write(json.dumps(msg) + "\n")
    process.stdin.flush()

# Step 1: Send the standard MCP initialize request
send_msg({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "python-bridge", "version": "1.0.0"}
    }
})

# Step 2: Listen on stdout line-by-line and process JSON-RPC
for line in iter(process.stdout.readline, ""):
    if not line.strip():
        continue
    try:
        msg = json.loads(line)
        if msg.get("id") == 1:
            # Server successfully initialized. Send notification and call the tool.
            send_msg({"jsonrpc": "2.0", "method": "notifications/initialized"})
            send_msg({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "search_workitems",
                    "arguments": {
                        "organizationId": ORG_ID,
                        "category": "Req,Task,Bug",
                        "spaceId": PROJECT_ID,
                        "perPage": 100
                    }
                }
            })
        elif msg.get("id") == 2:
            # Process tool execution results
            if "error" in msg:
                print(f"Error: {msg['error']}", file=sys.stderr)
                sys.exit(1)
            else:
                print(msg["result"]["content"][0]["text"])
            break
    except json.JSONDecodeError:
        pass

process.terminate()
