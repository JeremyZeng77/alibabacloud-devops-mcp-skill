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



---

## 🚀 6. Secure Deployment & GitOps Automation (GitHub Actions)

To host the dashboard online securely without exposing your credentials or maintaining a live server, you can set up a **Private GitHub Repository** and configure **GitHub Actions** to automate data updates.

### Step 1: Create a Private GitHub Repository
1. Create a new private repository on GitHub (e.g., `alibabacloud-devops-mcp-skill`).
2. Push your project files to the repository. Ensure `projects_history.db` and any local secrets are added to `.gitignore`.

### Step 2: Configure Repository Secrets
1. In your GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Click **New repository secret**.
3. Create a secret named `YUNXIAO_ACCESS_TOKEN` and paste your Yunxiao Personal Access Token (e.g. `pt-...`) as the value.
4. (Optional) If you have a specific organization ID, you can add it as `YUNXIAO_ORG_ID`.

### Step 3: Create GitHub Actions Workflow File
Create a new file named `.github/workflows/sync-data.yml` in your repository with the following configuration (this is already configured and pushed in the repository!):

```yaml
name: Sync Cloud DevOps Data and Deploy

on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch: # Allows manual trigger from GitHub UI

jobs:
  sync-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write # Required for committing changes and deploying pages
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Fetch and Compile DevOps Data
        env:
          YUNXIAO_ACCESS_TOKEN: ${{ secrets.YUNXIAO_ACCESS_TOKEN }}
          YUNXIAO_ORG_ID: ${{ secrets.YUNXIAO_ORG_ID }}
        run: |
          python dashboard/compile_projects_data.py --generate-weekly

      - name: Commit and Push Compiled Data
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add dashboard/projects_data.json dashboard/weekly_reports.md dashboard/projects_history.db
          git diff --quiet && git diff --staged --quiet || (git commit -m "chore: auto-sync DevOps progress data" && git push)

      - name: Install Node Dependencies
        run: |
          cd dashboard
          npm install

      - name: Build Dashboard
        run: |
          cd dashboard
          npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dashboard/dist
```

### Step 4: Host the Frontend (GitHub Pages)
The GitHub Actions workflow will automatically compile the data and publish the built frontend dashboard to the `gh-pages` branch. You only need to enable hosting in GitHub:
1. In your GitHub repository, go to **Settings** -> **Pages**.
2. Under **Build and deployment** -> **Branch**, select **`gh-pages`** and folder `/ (root)`.
3. Click **Save**.
4. GitHub will deploy your dashboard online! You can add your custom domain in the "Custom domain" box on that page.

Every 2 hours, the workflow will pull new data, commit it, rebuild the dashboard, and automatically redeploy it to GitHub Pages. No live servers are required!

---

> [!TIP]
> For optimal local testing, ensure the bridge server is running before navigating the dashboard.

