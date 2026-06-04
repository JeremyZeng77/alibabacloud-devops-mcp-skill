const { spawn } = require('child_process');

// 1. Configure Yunxiao access parameters (prefer env variables)
const YUNXIAO_TOKEN = process.env.YUNXIAO_ACCESS_TOKEN || "YOUR_YUNXIAO_ACCESS_TOKEN";
const ORG_ID = process.env.YUNXIAO_ORG_ID || "YOUR_ORGANIZATION_ID";
const PROJECT_ID = process.env.YUNXIAO_PROJECT_ID || "YOUR_PROJECT_ID";

// 2. Spawn the MCP Server process
const child = spawn('npx', ['-y', 'alibabacloud-devops-mcp-server'], {
  env: { ...process.env, YUNXIAO_ACCESS_TOKEN: YUNXIAO_TOKEN },
  shell: true
});

let stdoutData = '';

function sendJsonRpc(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

// 3. Handle incoming JSON-RPC responses from stdout
child.stdout.on('data', (data) => {
  stdoutData += data.toString();
  const lines = stdoutData.split('\n');
  stdoutData = lines.pop(); // Keep the incomplete line
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      
      // Step A: When initialized, send the initialized notification and invoke the target tool
      if (msg.id === 1) {
        sendJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
        
        // Example: Search work items
        sendJsonRpc({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "search_workitems",
            arguments: {
              organizationId: ORG_ID,
              category: "Req,Task,Bug",
              spaceId: PROJECT_ID,
              perPage: 100
            }
          }
        });
      } 
      // Step B: Receive tool execution results and output
      else if (msg.id === 2) {
        if (msg.error) {
          console.error("MCP Tool Call Error:", JSON.stringify(msg.error, null, 2));
          process.exit(1);
        } else {
          // Output the raw text result for the calling agent to parse
          console.log(msg.result.content[0].text);
        }
        child.kill();
        process.exit(0);
      }
    } catch (err) {
      // Ignore non-JSON logs (e.g. npx installation downloads or status info)
    }
  }
});

// 4. Initiate the standard MCP connection handshake
sendJsonRpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "agent-bridge-client", version: "1.0.0" }
  }
});

// 5. Timeout safeguard to terminate the subprocess
setTimeout(() => {
  child.kill();
  process.exit(1);
}, 20000);
