# Alibaba Cloud DevOps MCP Skill (云效 MCP 服务集成技能)

This repository defines how to integrate the **Alibaba Cloud DevOps (云效)** capability into any Agent framework (such as Antigravity, OpenClaw, Codex, Hermes, etc.) using the **Model Context Protocol (MCP)** standard interface.

It enables agents to automatically read, search, and analyze Yunxiao projects, work items, and repositories.

---

## 🛠️ 1. Skill Overview

*   **Skill Name**: `alibabacloud-devops-mcp`
*   **Description**: Empower agents with the ability to query organizations, search projects, retrieve requirements/tasks/bugs, get work item details, and list repositories/branches via Yunxiao OpenAPI and MCP.
*   **Prerequisites**:
    *   **Node.js** (v18 or higher)
    *   **Yunxiao Personal Access Token (PAT)**: With scopes for project management, work items, and code repositories (format: `pt-...`).

---

## ⚙️ 2. Standard MCP Client Configuration (`mcp.json`)

If your agent framework natively supports standard MCP Server, add the following to your agent's MCP configuration file (e.g., `mcp.json`):

```json
{
  "mcpServers": {
    "alibabacloud-devops": {
      "command": "npx",
      "args": [
        "-y",
        "alibabacloud-devops-mcp-server"
      ],
      "env": {
        "YUNXIAO_ACCESS_TOKEN": "YOUR_YUNXIAO_ACCESS_TOKEN_HERE"
      }
    }
  }
}
```

---

## 💻 3. Standalone Agent Bridge Scripts (For Non-MCP Native Frameworks)

If your agent framework **does not** natively support the MCP protocol but allows running scripts/commands, you can use these bridge scripts to communicate with the Yunxiao service process using JSON-RPC 2.0 over standard I/O (stdin/stdout).

- `mcp-bridge.js`: Standard Node.js client bridge script.
- `mcp-bridge.py`: Standard Python client bridge script.

Make sure to set the environment variable:
`YUNXIAO_ACCESS_TOKEN=pt-...`

---

## 🛠️ 4. Core MCP Tools Schema

| Tool Name | Purpose | Required Arguments |
| :--- | :--- | :--- |
| `get_user_organizations` | Retrieve user organizations | None |
| `search_projects` | Search projects in an organization | `organizationId`, `name` |
| `get_project` | Get metadata for a specific project | `organizationId`, `id` |
| `search_workitems` | Search requirements, tasks, bugs in a project | `organizationId`, `category`, `spaceId` |
| `get_workitem` | Get full details of a specific work item | `organizationId`, `workitemId` |
| `list_repositories` | Get code repositories list | `organizationId` |
| `list_branches` | Get branches of a repository | `organizationId`, `repositoryId` |

---

## 📊 5. Integrated Project Progress Dashboard (项目进度与甘特图协同看板)

This repository includes a built-in visual progress dashboard under the `dashboard/` directory. It visualizes organization-level deliverables, developer workloads, status distributions, and full-member schedules using an interactive Gantt chart.

### Features
1. **Requirements & Operations Dual-Row KPIs (需求与开发双排指标卡)**: Focuses separately on the business delivery (Requirements) and engineering pipeline (Tasks & Bugs).
2. **Stacked Multi-Dimensional Charts (堆叠负载与状态图表)**: Drill down into status queues and assignee workload components (Requirements vs Tasks vs Bugs).
3. **Interactive Gantt Chart (甘特日历排期图)**: day/week/month timeline adjustments, navigation controls, today alignment, and custom category filter tabs.
4. **Details Modal (详情交互弹窗)**: Access specific workitem fields (creation date, planned start, planned end) dynamically with fallback safety.
5. **Auto-Sync & Local Bridge (自动同步与静默编译)**: Periodic 5-minute background compilation using the bridge server.

### Run Dashboard Locally

1. **Install Dependencies**:
   Open a terminal in the `dashboard/` directory and install the required dev tools:
   ```bash
   npm install
   ```

2. **Start the Static Dashboard Server**:
   Run the local development server (powered by Vite):
   ```bash
   npm run dev
   ```

3. **Start the Python Bridge Server**:
   Start the local HTTP bridge server to receive manual/auto compilation commands:
   ```bash
   python bridge_server.py
   ```

Now open the hosted address (e.g. `http://localhost:5173/` or your LAN address `http://<your-ip>:5173/`) in your browser to view the live synchronized DevOps progress data.

