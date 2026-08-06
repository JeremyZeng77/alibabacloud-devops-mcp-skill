import sys
import json
import pathlib
import re
import os
import subprocess
import sqlite3
from datetime import datetime
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')

completed_status_list = [
    '已上线', '已关闭', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '生产验收通过',
    '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'
]
testing_status_list = ['测试中', '待测试', '提交测试', '发包已测试', '已提测']

ACTION_ITEM_REGEX = re.compile(
    r'^\s*-\s+(?:\[(?P<status>[ xX])\]\s*)?\[(?:负责人|Owner):\s*(?P<owner>[^\]]+)\]\[(?:截止日期|Due):\s*(?P<due>[^\]]+)\]\s*(?P<desc>.*)'
)

def parse_action_items(recommendations_text):
    items = []
    if not recommendations_text:
        return items
    for line in recommendations_text.splitlines():
        match = ACTION_ITEM_REGEX.match(line)
        if match:
            gd = match.groupdict()
            status_char = gd.get('status')
            is_completed = True if status_char in ['x', 'X'] else False
            items.append({
                'completed': is_completed,
                'owner': gd['owner'].strip(),
                'due': gd['due'].strip(),
                'desc': gd['desc'].strip()
            })
    return items

SCRIPT_DIR = pathlib.Path(__file__).parent.resolve()
DB_PATH = SCRIPT_DIR / "projects_history.db"

def init_sqlite_db():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS daily_project_snapshots (
        project TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        total_count INTEGER NOT NULL,
        completed_count INTEGER NOT NULL,
        status_counts TEXT NOT NULL,
        PRIMARY KEY (project, snapshot_date)
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS workitem_transitions (
        workitem_id TEXT NOT NULL,
        project TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        changed_date TEXT NOT NULL,
        PRIMARY KEY (workitem_id, status, changed_date)
    );
    """)
    # Check if workitem_type column exists, if not, alter table
    cursor.execute("PRAGMA table_info(workitem_transitions)")
    columns = [row[1] for row in cursor.fetchall()]
    if 'workitem_type' not in columns:
        cursor.execute("ALTER TABLE workitem_transitions ADD COLUMN workitem_type TEXT DEFAULT ''")
    conn.commit()
    conn.close()

def rebuild_history_from_captures(conn):
    print("Rebuilding database history from page-captures.jsonl...")
    cursor = conn.cursor()
    
    daily_snapshots = { 'mftb': {}, 'mfood': {} }
    
    if CAPTURES_PATH.exists():
        for line in CAPTURES_PATH.read_text(encoding='utf-8').splitlines():
            if not line.strip(): continue
            try:
                data = json.loads(line)
                url = data.get('browser', {}).get('url') or data.get('page', {}).get('url', '')
                items = data.get('page', {}).get('items', [])
                received_at = data.get('receivedAt', '')
                if not items or not received_at: continue
                
                date_str = received_at[:10]
                if 'ea6df73257b27472177527f38b' in url:
                    daily_snapshots['mftb'][date_str] = items
                elif 'b213ecf2c319097885faf16704' in url:
                    daily_snapshots['mfood'][date_str] = items
            except Exception:
                pass
                
        def parse_capture_item_status(item):
            row = item.get('rowText', '')
            status = item.get('status') or ''
            for st in completed_status_list + ['待处理', '开发中', '测试中']:
                if st in row:
                    status = st
                    break
            if not status: status = '待处理'
            return status

        # Build & insert snapshots
        for proj in ['mftb', 'mfood']:
            for d_str, items in daily_snapshots[proj].items():
                p_statuses = [parse_capture_item_status(it) for it in items]
                status_counts = dict(Counter(p_statuses))
                completed = sum(v for k, v in status_counts.items() if k in completed_status_list)
                
                cursor.execute("""
                    INSERT OR REPLACE INTO daily_project_snapshots (project, snapshot_date, total_count, completed_count, status_counts)
                    VALUES (?, ?, ?, ?, ?)
                """, (proj, d_str, len(items), completed, json.dumps(status_counts, ensure_ascii=False)))
                
        # Rebuild transitions
        item_status_history = {} # key: (project, title), value: list of (date_str, status, category)
        for proj in ['mftb', 'mfood']:
            for d_str, items in sorted(daily_snapshots[proj].items()):
                EXCLUDE_TITLE_REGEX = re.compile(r'\[(?:已取消|已废弃|重复|测试不通过)\]')
                for it in items:
                    title = it.get('title', '').strip()
                    if not title: continue
                    if EXCLUDE_TITLE_REGEX.search(title): continue
                    
                    status = it.get('status') or ''
                    if not status:
                        row = it.get('rowText', '')
                        for st in completed_status_list + ['待处理', '开发中', '测试中']:
                            if st in row:
                                status = st
                                break
                    if not status: status = '待处理'
                    
                    category = it.get('workItemType') or it.get('itemLevel') or 'Req'
                    if category == 'requirement': category = 'Req'
                    elif category == 'task': category = 'Task'
                    elif category == 'bug': category = 'Bug'
                    
                    key = (proj, title)
                    if key not in item_status_history:
                        item_status_history[key] = []
                    item_status_history[key].append((d_str, status, category, it.get('workItemType') or ''))
                    
        for (proj, title), history in item_status_history.items():
            history.sort(key=lambda x: x[0])
            prev_status = None
            for date_str, status, category, wi_type in history:
                if status != prev_status:
                    cursor.execute("""
                        INSERT OR REPLACE INTO workitem_transitions (workitem_id, project, category, status, changed_date, workitem_type)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (title, proj, category, status, date_str, wi_type))
                    prev_status = status
                    
        conn.commit()
        print("Database history rebuild completed.")

def check_and_rebuild_db():
    init_sqlite_db()
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM daily_project_snapshots")
    count = cursor.fetchone()[0]
    if count == 0:
        rebuild_history_from_captures(conn)
    conn.close()

def log_live_workitem_transitions(conn, workitems, project_key):
    cursor = conn.cursor()
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    EXCLUDE_TITLE_REGEX = re.compile(r'\[(?:已取消|已废弃|重复|测试不通过)\]')
    for item in workitems:
        if EXCLUDE_TITLE_REGEX.search(item.get('title', '')):
            continue
        workitem_id = item['id']
        category = item['category']
        current_status = item['status']
        create_date = item.get('createDate') or today_str
        
        cursor.execute("""
            SELECT status, changed_date FROM workitem_transitions 
            WHERE workitem_id = ? AND project = ? 
            ORDER BY changed_date DESC, rowid DESC LIMIT 1
        """, (workitem_id, project_key))
        
        row = cursor.fetchone()
        wi_type = item.get('workItemType') or ''
        if not row:
            cursor.execute("""
                INSERT OR IGNORE INTO workitem_transitions (workitem_id, project, category, status, changed_date, workitem_type)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (workitem_id, project_key, category, '待处理', create_date, wi_type))
            
            if current_status != '待处理':
                cursor.execute("""
                    INSERT OR IGNORE INTO workitem_transitions (workitem_id, project, category, status, changed_date, workitem_type)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (workitem_id, project_key, category, current_status, today_str, wi_type))
        else:
            last_status, last_date = row
            if current_status != last_status:
                cursor.execute("""
                    INSERT OR IGNORE INTO workitem_transitions (workitem_id, project, category, status, changed_date, workitem_type)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (workitem_id, project_key, category, current_status, today_str, wi_type))
    conn.commit()

def calculate_lead_time_kpi(conn, project_key):
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT workitem_id, category, status, changed_date, workitem_type 
        FROM workitem_transitions 
        WHERE project = ? 
        ORDER BY changed_date ASC, rowid ASC
    """, (project_key,))
    
    rows = cursor.fetchall()
    
    item_transitions = {}
    for workitem_id, category, status, changed_date, workitem_type in rows:
        if workitem_id not in item_transitions:
            item_transitions[workitem_id] = []
        item_transitions[workitem_id].append((status, changed_date, category, workitem_type))
        
    completed_status_set = set(completed_status_list)
    progress_status_set = {'进行中', '开发中', '开始开发', '处理中'}
    exclude_status_set = {'已取消', '已废弃', '已拒绝', '重复', '非问题', '挂起', '已废弃(不予解决)', '暂不修复'}
    
    cycle_times = []
    
    EXCLUDE_TITLE_REGEX = re.compile(r'\[(?:已取消|已废弃|重复|测试不通过)\]')
    for workitem_id, transitions in item_transitions.items():
        is_excluded = False
        if EXCLUDE_TITLE_REGEX.search(workitem_id):
            is_excluded = True
        else:
            for status, _, _, _ in transitions:
                if status in exclude_status_set:
                    is_excluded = True
                    break
        if is_excluded:
            continue
            
        t_progress = None
        t_completed = None
        
        for status, date_str, _, wi_type in transitions:
            is_completed = False
            if status in completed_status_set:
                is_completed = True
            elif status == '提交测试' and wi_type != '測試':
                is_completed = True

            if status in progress_status_set:
                if t_progress is None or date_str < t_progress:
                    t_progress = date_str
            elif is_completed:
                if t_completed is None or date_str < t_completed:
                    t_completed = date_str
                    
        if t_progress and t_completed:
            try:
                d_prog = datetime.strptime(t_progress, '%Y-%m-%d')
                d_comp = datetime.strptime(t_completed, '%Y-%m-%d')
                diff_days = (d_comp - d_prog).days
                if diff_days >= 0:
                    cycle_times.append((d_comp, diff_days))
            except Exception:
                pass
                
    today = datetime.now()
    last_30_days_values = []
    prev_30_days_values = []
    
    for comp_date, diff_days in cycle_times:
        age_days = (today - comp_date).days
        if 0 <= age_days < 30:
            last_30_days_values.append(diff_days)
        elif 30 <= age_days < 60:
            prev_30_days_values.append(diff_days)
            
    avg_30 = round(sum(last_30_days_values) / len(last_30_days_values), 1) if last_30_days_values else 0.0
    avg_prev = round(sum(prev_30_days_values) / len(prev_30_days_values), 1) if prev_30_days_values else 0.0
    delta = round(avg_30 - avg_prev, 1)
    
    return {
        'average': avg_30,
        'delta': delta
    }

def insert_today_snapshot(conn, project_key, parsed_items):
    today_str = datetime.now().strftime('%Y-%m-%d')
    cursor = conn.cursor()
    
    task_items = [it for it in parsed_items if it.get('category') == 'Task']
    status_counts = dict(Counter([it['status'] for it in task_items]))
    total = len(task_items)
    
    completed = 0
    for item in task_items:
        status = item.get('status')
        wi_type = item.get('workItemType')
        is_comp = False
        if status in completed_status_list:
            is_comp = True
        elif status in testing_status_list:
            if wi_type != '測試':
                is_comp = True
        if is_comp:
            completed += 1
            
    cursor.execute("""
        INSERT OR REPLACE INTO daily_project_snapshots (project, snapshot_date, total_count, completed_count, status_counts)
        VALUES (?, ?, ?, ?, ?)
    """, (project_key, today_str, total, completed, json.dumps(status_counts, ensure_ascii=False)))
    conn.commit()

def reconstruct_history_timeline(conn, project_key, parsed_items):
    cursor = conn.cursor()
    from datetime import timedelta
    
    # 1. Query transitions log for this project
    cursor.execute("""
        SELECT workitem_id, status, changed_date, workitem_type 
        FROM workitem_transitions 
        WHERE project = ?
        ORDER BY changed_date ASC, rowid ASC
    """, (project_key,))
    transitions_rows = cursor.fetchall()
    
    item_completion_dates = {}
    completed_status_set = set(completed_status_list)
    
    for workitem_id, status, changed_date, wi_type in transitions_rows:
        is_comp = False
        if status in completed_status_set:
            is_comp = True
        elif status == '提交测试' and wi_type != '測試':
            is_comp = True
            
        if is_comp:
            if workitem_id not in item_completion_dates:
                item_completion_dates[workitem_id] = changed_date
            else:
                if changed_date < item_completion_dates[workitem_id]:
                    item_completion_dates[workitem_id] = changed_date
                    
    # 2. Build items data
    reconstructed_items = []
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    for item in parsed_items:
        cat = item.get('category')
        if cat not in ['Req', 'Task']:
            continue
        create_date = item.get('createDate')
        if not create_date:
            continue
            
        workitem_id = item['id']
        title = item.get('title', '')
        plan_end = item.get('planEnd')
        
        status = item.get('status', '')
        wi_type = item.get('workItemType', '')
        
        is_comp = False
        if status in completed_status_list:
            is_comp = True
        elif status in testing_status_list:
            if wi_type != '測試':
                is_comp = True
                
        comp_date = None
        if is_comp:
            # Check transitions
            trans_date = item_completion_dates.get(workitem_id) or item_completion_dates.get(title)
            
            # If transition date is June 10, and item was created before June 3 (more than 7 days gap),
            # it is likely a bulk-load artifact. Ignore it and fallback.
            trust_trans = True
            if trans_date == '2026-06-10':
                try:
                    c_dt = datetime.strptime(create_date, '%Y-%m-%d')
                    t_dt = datetime.strptime(trans_date, '%Y-%m-%d')
                    if (t_dt - c_dt).days > 7:
                        trust_trans = False
                except:
                    pass
            
            if trans_date and trust_trans and trans_date < today_str:
                comp_date = trans_date
            elif plan_end and plan_end <= today_str:
                comp_date = plan_end
            else:
                try:
                    c_dt = datetime.strptime(create_date, '%Y-%m-%d')
                    comp_dt = c_dt + timedelta(days=3)
                    comp_date = comp_dt.strftime('%Y-%m-%d')
                    if comp_date > today_str:
                        comp_date = today_str
                except:
                    comp_date = create_date
                    
        reconstructed_items.append({
            'create': create_date,
            'completed': comp_date
        })
        
    if not reconstructed_items:
        return
        
    # Find min creation date
    create_dates = [x['create'] for x in reconstructed_items if x['create']]
    if not create_dates:
        return
    min_date_str = min(create_dates)
    
    # Delete existing entries for this project in snapshots table to avoid duplicates or old formats
    cursor.execute("DELETE FROM daily_project_snapshots WHERE project = ?", (project_key,))
    
    current_date = datetime.strptime(min_date_str, '%Y-%m-%d')
    end_date = datetime.strptime(today_str, '%Y-%m-%d')
    
    while current_date <= end_date:
        d_str = current_date.strftime('%Y-%m-%d')
        
        total = sum(1 for x in reconstructed_items if x['create'] <= d_str)
        completed = sum(1 for x in reconstructed_items if x['create'] <= d_str and x['completed'] and x['completed'] <= d_str)
        
        status_counts = {"已完成": completed, "进行中": total - completed}
        
        cursor.execute("""
            INSERT OR REPLACE INTO daily_project_snapshots (project, snapshot_date, total_count, completed_count, status_counts)
            VALUES (?, ?, ?, ?, ?)
        """, (project_key, d_str, total, completed, json.dumps(status_counts, ensure_ascii=False)))
        
        current_date += timedelta(days=1)
        
    conn.commit()

def load_history_from_db():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("""
        SELECT project, snapshot_date, total_count, completed_count, status_counts 
        FROM daily_project_snapshots 
        ORDER BY snapshot_date ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    history_timeline = {
        'mftb': [],
        'mfood': []
    }
    
    for project, snapshot_date, total_count, completed_count, status_counts_json in rows:
        history_timeline[project].append({
            'date': snapshot_date,
            'total': total_count,
            'completed': completed_count,
            'statusCounts': json.loads(status_counts_json)
        })
        
    return history_timeline


# To run this script locally or in CI/CD, ensure YUNXIAO_ACCESS_TOKEN is set in your environment variables.
# Do NOT hardcode your Personal Access Token here to prevent security leaks in GitHub repository commits.
YUNXIAO_TOKEN = os.environ.get("YUNXIAO_ACCESS_TOKEN", "")
ORG_ID = os.environ.get("YUNXIAO_ORG_ID", "5f1ac684769820a3e817ed55")
MFTB_PROJECT_ID = "ea6df73257b27472177527f38b"
MFOOD_PROJECT_ID = "b213ecf2c319097885faf16704"

CAPTURES_PATH = pathlib.Path(r'C:\Users\DELL\.openclaw\workspace-gemma-chat\state\project-bridge\page-captures.jsonl')
WEEKLY_REPORTS_PATH = SCRIPT_DIR / "weekly_reports.md"
OUTPUT_PATH = SCRIPT_DIR / "data" / "projects_data.json"

completed_status_list = [
    '已上线', '已关闭', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '生产验收通过',
    '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'
]
testing_status_list = ['测试中', '待测试', '提交测试', '发包已测试', '已提测']

# Fetch workitems from Yunxiao MCP server
import time

def fetch_mcp_workitems(project_id, category="Req,Task,Bug", status_stage="1,2", per_page=200, page=1):
    for attempt in range(1, 4):
        env = os.environ.copy()
        env["YUNXIAO_ACCESS_TOKEN"] = YUNXIAO_TOKEN
        
        kwargs = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "encoding": 'utf-8',
            "env": env
        }
        if os.name == 'nt':
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            kwargs["shell"] = True
        else:
            kwargs["shell"] = False
        
        process = subprocess.Popen(
            ["npx", "-y", "alibabacloud-devops-mcp-server"],
            **kwargs
        )
        
        def send_msg(msg):
            process.stdin.write(json.dumps(msg) + "\n")
            process.stdin.flush()
            
        # Initialize handshake
        send_msg({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "python-compiler", "version": "1.0.0"}
            }
        })
        
        items = None
        error_occurred = False
        
        for line in iter(process.stdout.readline, ""):
            if not line.strip():
                continue
            try:
                msg = json.loads(line)
                if msg.get("id") == 1:
                    # Handshake succeeded, send initialized and call tool
                    send_msg({"jsonrpc": "2.0", "method": "notifications/initialized"})
                    
                    args = {
                        "organizationId": ORG_ID,
                        "category": category,
                        "spaceId": project_id,
                        "perPage": per_page,
                        "page": page
                    }
                    if status_stage:
                        args["statusStage"] = status_stage
                        
                    send_msg({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/call",
                        "params": {
                            "name": "search_workitems",
                            "arguments": args
                        }
                    })
                elif msg.get("id") == 2:
                    if "error" in msg:
                        print(f"      [Attempt {attempt}] Error: {msg['error']}", file=sys.stderr)
                        error_occurred = True
                    else:
                        text_content = msg["result"]["content"][0]["text"]
                        res_obj = json.loads(text_content)
                        items = res_obj.get("items", [])
                    break
            except Exception as e:
                error_occurred = True
                
        process.terminate()
        
        if not error_occurred and items is not None:
            return items
            
        print(f"      [Attempt {attempt}] Fetch failed. Retrying in 2 seconds...", file=sys.stderr)
        time.sleep(2)
        
    return []

# Map DevOps item structure to dashboard item structure
def map_devops_item(item, project_name, category="Req"):
    title = item.get('subject', '').strip()
    serial_number = item.get('serialNumber', '')
    
    status_obj = item.get('status', {})
    status = status_obj.get('displayName') or status_obj.get('name', '待处理')
    
    # Priority
    priority = '中'
    for cf in item.get('customFieldValues', []):
        if cf.get('fieldId') == 'priority':
            vals = cf.get('values', [])
            if vals:
                priority = vals[0].get('displayValue', '中')
                
    # Assignee
    ass_obj = item.get('assignedTo', {})
    assignee = ass_obj.get('name') or '未指派'
    
    # Creator
    cre_obj = item.get('creator', {})
    creator = cre_obj.get('name') or '未指派'
    
    # Iteration (Sprint)
    sprint_obj = item.get('sprint')
    iteration = '未规划'
    if sprint_obj and isinstance(sprint_obj, dict):
        iteration = sprint_obj.get('name', '未规划')
        
    # Plan Start & Plan End Dates from Custom Fields
    plan_start = ''
    plan_end = ''
    for cf in item.get('customFieldValues', []):
        field_id = cf.get('fieldId')
        if field_id == '79': # 计划开始时间
            vals = cf.get('values', [])
            if vals:
                display_val = vals[0].get('displayValue', '')
                if display_val:
                    plan_start = display_val.split(' ')[0] # yyyy-MM-dd
        elif field_id == '80': # 计划完成时间
            vals = cf.get('values', [])
            if vals:
                display_val = vals[0].get('displayValue', '')
                if display_val:
                    plan_end = display_val.split(' ')[0] # yyyy-MM-dd

    # Parse creation date
    gmt_create = item.get('gmtCreate', 0)
    create_date = ''
    if gmt_create:
        dt = datetime.fromtimestamp(gmt_create / 1000.0)
        create_date = dt.strftime('%Y-%m-%d')
        
    # Type
    type_obj = item.get('workitemType', {})
    workitem_type = type_obj.get('name', '需求')
    
    # Raw log representation (styled terminal rowText)
    row_text = f"【{workitem_type}】{title}\n"
    row_text += f"ID: {serial_number} | 状态: {status} | 优先级: {priority}\n"
    row_text += f"负责人: {assignee} | 提报人: {creator}\n"
    row_text += f"迭代版本: {iteration} | 创建时间: {create_date} | 排期规划: {plan_start or '-'} 至 {plan_end or '-'}"
    
    # Link
    url = ''
    if item.get('id'):
        url = f"https://devops.aliyun.com/projex/project/{item.get('space', {}).get('id')}/req#openWorkitemIdentifier={item.get('id')}"
        
    return {
        'id': serial_number,
        'title': title,
        'status': status,
        'priority': priority,
        'assignee': assignee,
        'creator': creator,
        'iteration': iteration,
        'planStart': plan_start,
        'planEnd': plan_end,
        'createDate': create_date,
        'workItemType': workitem_type,
        'url': url,
        'rowText': row_text,
        'project': project_name,
        'category': category
    }

# Helper to split section body by project affinity
def split_markdown_by_project(text):
    mftb_blocks = []
    mfood_blocks = []
    
    # Group lines into logical blocks: (parent_line, sub_lines)
    blocks = []
    current_block = None
    
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        # Check indentation: starts with spaces or tab
        if line.startswith(' ') or line.startswith('\t'):
            if current_block is not None:
                current_block[1].append(line)
            else:
                blocks.append((line, []))
        else:
            current_block = (line, [])
            blocks.append(current_block)
            
    # Helper to check if a line is a project header
    def get_project_header_type(line):
        clean = line.strip().strip('-*# ').strip('：')
        if clean in ["**MFTB 集团项目**", "MFTB 集团项目", "**MFTB集团项目**", "**MFTB 集团项目建议**", "MFTB 集团项目建议", "**MFTB集团项目建议**"]:
            return "mftb"
        if clean in ["**mFood 综合版本**", "mFood 综合版本", "**mFood综合版本**", "**mFood 综合版本建议**", "mFood 综合版本建议", "**mFood综合版本建议**"]:
            return "mfood"
        return None

    # Helper to check keywords in a line
    def get_line_project_affinity(line):
        line_lower = line.lower()
        has_mftb = "mftb" in line_lower or "集团项目" in line_lower or "合同管理" in line_lower
        has_mfood = "mfood" in line_lower or "综合版本" in line_lower or "消费金" in line_lower or "李云锋" in line_lower or "朱家萱" in line_lower or "支付宝" in line_lower or "微信" in line_lower
        if has_mftb and not has_mfood:
            return "mftb"
        if has_mfood and not has_mftb:
            return "mfood"
        return "both"

    for parent_line, sub_lines in blocks:
        # Check if parent is a project header
        header_type = get_project_header_type(parent_line)
        if header_type == "mftb":
            # Flatten sub_lines to top-level bullets
            for sl in sub_lines:
                flattened = sl[2:] if sl.startswith('  ') else (sl[4:] if sl.startswith('    ') else sl.lstrip())
                if flattened.strip().startswith('-') or flattened.strip().startswith('*') or (flattened.strip() and flattened.strip()[0].isdigit() and '.' in flattened.strip()[:3]):
                    mftb_blocks.append(flattened)
                else:
                    mftb_blocks.append(f"- {flattened}")
            continue
        elif header_type == "mfood":
            # Flatten sub_lines to top-level bullets
            for sl in sub_lines:
                flattened = sl[2:] if sl.startswith('  ') else (sl[4:] if sl.startswith('    ') else sl.lstrip())
                if flattened.strip().startswith('-') or flattened.strip().startswith('*') or (flattened.strip() and flattened.strip()[0].isdigit() and '.' in flattened.strip()[:3]):
                    mfood_blocks.append(flattened)
                else:
                    mfood_blocks.append(f"- {flattened}")
            continue
            
        # Check parent affinity
        parent_affinity = get_line_project_affinity(parent_line)
        
        if parent_affinity == "mftb":
            mftb_blocks.append(parent_line)
            mftb_blocks.extend(sub_lines)
        elif parent_affinity == "mfood":
            mfood_blocks.append(parent_line)
            mfood_blocks.extend(sub_lines)
        else:
            # Shared parent
            if not sub_lines:
                mftb_blocks.append(parent_line)
                mfood_blocks.append(parent_line)
            else:
                mftb_sub = []
                mfood_sub = []
                for sl in sub_lines:
                    sl_affinity = get_line_project_affinity(sl)
                    if sl_affinity == "mftb":
                        mftb_sub.append(sl)
                    elif sl_affinity == "mfood":
                        mfood_sub.append(sl)
                    else:
                        mftb_sub.append(sl)
                        mfood_sub.append(sl)
                if mftb_sub:
                    mftb_blocks.append(parent_line)
                    mftb_blocks.extend(mftb_sub)
                if mfood_sub:
                    mfood_blocks.append(parent_line)
                    mfood_blocks.extend(mfood_sub)

    # Renumber list items sequentially
    def renumber_list_items(lines_list):
        renumbered = []
        counter = 1
        for line in lines_list:
            stripped = line.strip()
            match = re.match(r'^(\d+)\.\s+(.*)$', stripped)
            if match:
                content = match.group(2)
                indent_len = len(line) - len(line.lstrip())
                indent = line[:indent_len]
                renumbered.append(f"{indent}{counter}. {content}")
                counter += 1
            else:
                renumbered.append(line)
        return renumbered

    mftb_lines = renumber_list_items(mftb_blocks)
    mfood_lines = renumber_list_items(mfood_blocks)

    return '\n'.join(mftb_lines), '\n'.join(mfood_lines)

# Parse weekly Markdown reports
def parse_weekly_reports(md_path):
    if not md_path.exists():
        return []
    
    content = md_path.read_text(encoding='utf-8')
    blocks = content.split('## [')
    reports = []
    
    for block in blocks[1:]:
        lines = block.split('\n', 1)
        if not lines:
            continue
        header = lines[0].split(']')[0].strip()
        if '开始日期' in header or '结束日期' in header:
            continue
        body = lines[1] if len(lines) > 1 else ''
        
        sections = body.split('### ')
        
        # Initialize sections dict
        week_data = {
            'week': header,
            'mftb': {
                'metrics': '',
                'progress': '',
                'planning': '',
                'assessment': '',
                'risks': '',
                'recommendations': ''
            },
            'mfood': {
                'metrics': '',
                'progress': '',
                'planning': '',
                'assessment': '',
                'risks': '',
                'recommendations': ''
            }
        }
        
        for sec in sections[1:]:
            sec_lines = sec.split('\n', 1)
            sec_title = sec_lines[0].strip()
            sec_body = sec_lines[1] if len(sec_lines) > 1 else ''
            
            key = None
            if '0' in sec_title or '大盘' in sec_title or '指标' in sec_title or '数据' in sec_title:
                key = 'metrics'
            elif '1' in sec_title or '进展' in sec_title or '里程碑' in sec_title:
                key = 'progress'
            elif '2' in sec_title or '规划' in sec_title:
                key = 'planning'
            elif '3' in sec_title or '总结' in sec_title or '评估' in sec_title:
                key = 'assessment'
            elif '4' in sec_title or '研发资源' in sec_title or '风险' in sec_title:
                key = 'risks'
            elif '5' in sec_title or '建议' in sec_title:
                key = 'recommendations'
                
            if key:
                # Split body by project affinity
                mftb_text, mfood_text = split_markdown_by_project(sec_body)
                week_data['mftb'][key] = mftb_text.strip()
                week_data['mfood'][key] = mfood_text.strip()
                
        # Parse action items under recommendations key
        for proj in ['mftb', 'mfood']:
            recs_text = week_data[proj]['recommendations']
            week_data[proj]['actionItems'] = parse_action_items(recs_text)
                
        reports.append(week_data)
    return reports

def fetch_project_items(project_id, project_name):
    print(f"  - Fetching project {project_name}...")
    
    categories = ["Req", "Task", "Bug"]
    merged = {}
    
    # Check if MFTB (small project) or mFood (huge project)
    is_mftb = (project_id == "ea6df73257b27472177527f38b")
    
    if is_mftb:
        # For MFTB, query ALL items page-by-page without statusStage filter
        for cat in categories:
            page = 1
            while True:
                print(f"    * Querying all items for category {cat} (page {page})...")
                items = fetch_mcp_workitems(project_id, category=cat, status_stage=None, per_page=200, page=page)
                print(f"      Found {len(items)} items.")
                if not items:
                    break
                for it in items:
                    mapped = map_devops_item(it, project_name, cat)
                    merged[mapped['id']] = mapped
                if len(items) < 200:
                    break
                page += 1
    else:
        # For mFood, query active items (stages 1,2) and recent completed (stage 3)
        for cat in categories:
            # 1. Fetch active items (stages 1,2)
            page = 1
            while True:
                print(f"    * Querying active items for category {cat} (page {page})...")
                active_items = fetch_mcp_workitems(project_id, category=cat, status_stage="1,2", per_page=200, page=page)
                print(f"      Found {len(active_items)} items.")
                if not active_items:
                    break
                for it in active_items:
                    mapped = map_devops_item(it, project_name, cat)
                    merged[mapped['id']] = mapped
                if len(active_items) < 200:
                    break
                page += 1
                
            # 2. Fetch completed items (stage 3) - page 1 only (latest 200 items)
            print(f"    * Querying completed items for category {cat} (page 1)...")
            completed_items = fetch_mcp_workitems(project_id, category=cat, status_stage="3", per_page=200, page=1)
            print(f"      Found {len(completed_items)} items.")
            for it in completed_items:
                mapped = map_devops_item(it, project_name, cat)
                if mapped['id'] not in merged:
                    merged[mapped['id']] = mapped
                    
    return list(merged.values())

def populate_missing_workitem_types(conn, workitems, project_key):
    cursor = conn.cursor()
    for item in workitems:
        workitem_id = item['id']
        wi_type = item.get('workItemType') or ''
        if wi_type:
            cursor.execute("""
                UPDATE workitem_transitions 
                SET workitem_type = ? 
                WHERE workitem_id = ? AND project = ? AND (workitem_type IS NULL OR workitem_type = '')
            """, (wi_type, workitem_id, project_key))
    conn.commit()


def generate_weekly_report_content(conn, parsed_mftb, parsed_mfood):
    from datetime import datetime, timedelta
    
    # 1. Determine Monday and Friday of the current week
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    friday = monday + timedelta(days=4)
    
    start_date_str = monday.strftime('%Y-%m-%d')
    end_date_str = friday.strftime('%Y-%m-%d')
    week_header = f"{start_date_str} 至 {end_date_str}"
    
    # 2. Query transitions log for MFTB and mFood
    cursor = conn.cursor()
    cursor.execute("""
        SELECT workitem_id, status, changed_date, project, category, workitem_type
        FROM workitem_transitions
        WHERE changed_date >= ? AND changed_date <= ?
    """, (start_date_str, end_date_str))
    weekly_transitions = cursor.fetchall()
    
    mftb_transitions = [t for t in weekly_transitions if t[3] == 'mftb']
    mfood_transitions = [t for t in weekly_transitions if t[3] == 'mfood']
    
    # Flowed items count (unique workitem_ids)
    mftb_flow = len(set(t[0] for t in mftb_transitions))
    mfood_flow = len(set(t[0] for t in mfood_transitions))
    
    # Created items this week
    mftb_new_items = [it for it in parsed_mftb if it.get('createDate') and start_date_str <= it['createDate'] <= end_date_str]
    mfood_new_items = [it for it in parsed_mfood if it.get('createDate') and start_date_str <= it['createDate'] <= end_date_str]
    
    mftb_new = len(mftb_new_items)
    mfood_new = len(mfood_new_items)
    
    # Count by category
    def count_by_cat(items, cat):
        return sum(1 for it in items if it.get('category') == cat)
        
    mftb_new_task = count_by_cat(mftb_new_items, 'Task')
    mftb_new_req = count_by_cat(mftb_new_items, 'Req')
    mftb_new_bug = count_by_cat(mftb_new_items, 'Bug')
    
    mfood_new_task = count_by_cat(mfood_new_items, 'Task')
    mfood_new_req = count_by_cat(mfood_new_items, 'Req')
    mfood_new_bug = count_by_cat(mfood_new_items, 'Bug')
    
    # Status distribution for MFTB
    mftb_total = len(parsed_mftb)
    mftb_status_counts = Counter([it['status'] for it in parsed_mftb])
    
    def get_status_stats(status_name):
        cnt = mftb_status_counts.get(status_name, 0)
        pct = round((cnt / mftb_total * 100), 1) if mftb_total > 0 else 0.0
        return cnt, pct
        
    mftb_st_tjcs, mftb_pct_tjcs = get_status_stats('提交测试')
    mftb_st_ywc, mftb_pct_ywc = get_status_stats('已完成')
    mftb_st_kfz, mftb_pct_kfz = get_status_stats('开发中')
    mftb_st_dcl, mftb_pct_dcl = get_status_stats('待处理')
    
    # Accomplishments and Planning lists
    mftb_comp_list = []
    for it in parsed_mftb:
        is_comp = it['status'] in completed_status_list or (it['status'] in testing_status_list and it.get('workItemType') != '測試')
        if is_comp:
            mftb_comp_list.append(it)
    mftb_comp_list.sort(key=lambda x: x.get('createDate', ''), reverse=True)
    
    mftb_acc_str = ""
    if mftb_comp_list:
        for it in mftb_comp_list[:3]:
            mftb_acc_str += f"  - **{it.get('title')}**：工作项 `[{it.get('id')}]` (负责人: {it.get('assignee')}) 已流转至 **{it.get('status')}** 状态。\n"
    else:
        mftb_acc_str = "  - **阶段推进**：核心模块和子任务按计划开发联调，本周无新增闭环大系统需求。\n"
        
    mfood_comp_list = []
    for it in parsed_mfood:
        is_comp = it['status'] in completed_status_list or (it['status'] in testing_status_list and it.get('workItemType') != '測試')
        if is_comp:
            mfood_comp_list.append(it)
    mfood_comp_list.sort(key=lambda x: x.get('createDate', ''), reverse=True)
    mfood_acc_str = ""
    if mfood_comp_list:
        for it in mfood_comp_list[:3]:
            mfood_acc_str += f"  - **{it.get('title')}**：工作项 `[{it.get('id')}]` (负责人: {it.get('assignee')}) 已流转至 **{it.get('status')}** 状态。\n"
    else:
        mfood_acc_str = "  - **功能上线**：本周各项综合版本子需求正在有序进行提测与回归，等待发包验证。\n"
        
    mftb_plan_list = [it for it in parsed_mftb if it['status'] not in completed_status_list]
    mftb_plan_list.sort(key=lambda x: x.get('createDate', ''), reverse=True)
    mftb_plan_str = ""
    if mftb_plan_list:
        for it in mftb_plan_list[:3]:
            mftb_plan_str += f"  - **{it.get('title')}**：新进规划工作项 `[{it.get('id')}]` (负责人: {it.get('assignee')})，当前处于 **{it.get('status')}** 状态。\n"
    else:
        mftb_plan_str = "  - **规划跟进**：无新增待排期规划需求，主要集中推进现有开发中队列。\n"
        
    mfood_plan_list = [it for it in parsed_mfood if it['status'] not in completed_status_list]
    mfood_plan_list.sort(key=lambda x: x.get('createDate', ''), reverse=True)
    mfood_plan_str = ""
    if mfood_plan_list:
        for it in mfood_plan_list[:3]:
            mfood_plan_str += f"  - **{it.get('title')}**：新进规划工作项 `[{it.get('id')}]` (负责人: {it.get('assignee')})，当前处于 **{it.get('status')}** 状态。\n"
    else:
        mfood_plan_str = "  - **版本推进**：主要排期后续 V7.2.5/V7.3.0 接口定义与用户端 UI 优化设计。\n"
        
    risks_list = []
    mftb_testing_count = sum(1 for it in parsed_mftb if it['status'] in testing_status_list and it.get('workItemType') == '測試')
    if mftb_testing_count > 10:
        risks_list.append(f"  - **[WARNING] 云效 DevOps 协同看板测试资源严重“塞车” (QA Bottleneck)**：当前处于测试中或待测试状态的项达 {mftb_testing_count} 项。测试资源分配存在倾斜风险，需协调产品经理与业务线协助验收。")
        
    if not risks_list:
        risks_list.append("  - **[NOTE] 进度无明显延期风险**：本周开发与测试配合良好，各项任务按时推进。")
    risks_str = "\n".join(risks_list)
    
    due_1 = (today + timedelta(days=4)).strftime('%Y-%m-%d')
    due_2 = (today + timedelta(days=7)).strftime('%Y-%m-%d')
    due_3 = (today + timedelta(days=3)).strftime('%Y-%m-%d')
    
    new_report = f"""## [{week_header}]

### 0. 本周项目管理大盘数据
- **MFTB 集团项目**：
  - 本周是 MFTB 集团项目研发交付推进周。本周新创建了 **{mftb_new}** 项任务，同时有 **{mftb_flow}** 项存量任务得到了研发或测试的流转更新。
  - **新创建任务分类统计**：
    - 开发子任务 (Task)：{mftb_new_task} 项
    - 产品类需求 (Requirement)：{mftb_new_req} 项
    - 缺陷 (Bug)：{mftb_new_bug} 项
  - **核心迭代 MFTB-v1.0.0 最新状态分布**：
    | 状态 | 数量 | 占比 | 状态含义与关键进展 |
    | --- | --- | --- | --- |
    | 提交测试 | {mftb_st_tjcs} | {mftb_pct_tjcs}% | 研发大面积闭环，本周有较多子任务 and 变更单进入测试队列。 |
    | 已完成 | {mftb_st_ywc} | {mftb_pct_ywc}% | 部分产品原型与商圈品类功能已开发验收完成。 |
    | 开发中 | {mftb_st_kfz} | {mftb_pct_kfz}% | 部分到家业务商品标签/参数联调中。 |
    | 待处理 | {mftb_st_dcl} | {mftb_pct_dcl}% | 包含新增的后续规划中的需求。 |
- **mFood 综合版本**：
  - 本周对 V7.2.0、V7.2.5 以及 0.0.0 迭代进行了重点推进。本周新创建了 **{mfood_new}** 项任务，同时有 **{mfood_flow}** 项存量任务得到了研发或测试的流转更新。
  - **新创建任务分类统计**：
    - 开发子任务 (Task)：{mfood_new_task} 项
    - 产品类需求 (Requirement)：{mfood_new_req} 项
    - 缺陷 (Bug)：{mfood_new_bug} 项

### 1. 本周核心进展与里程碑成果
- **MFTB 集团项目**：
{mftb_acc_str}- **mFood 综合版本**：
{mfood_acc_str}
### 2. 本周新增核心规划
- **MFTB 集团项目**：
{mftb_plan_str}- **mFood 综合版本**：
{mfood_plan_str}
### 3. 全局项目进度总结与主流程评估
- **MFTB 集团项目**：
  - 目前核心业务模块的底层架构和配置已大面积完成开发并交付测试。主要卡点仍在于订单与在线支付通道联调，需加速相应研发进度以确保闭环交易流程的贯通。
- **mFood 综合版本**：
  - 核心功能按计划稳定推进，控制性灰度测试与通道联调正常，无明显发布延期风险。

### 4. 研发资源与交付风险警告
{risks_str}

### 5. 技术管理建议
- **MFTB 集团项目建议**：
  - [负责人: 廖荣][截止日期: {due_1}] 疏通：紧急启动并优先排期“订单与支付”专项，将核心任务优先级提到最高 (P0)。
  - [负责人: 覃林方][截止日期: {due_2}] 协调：如果“提交测试”队列过长，协调产品协助功能验收测试，合理分配测试资源。
- **mFood 综合版本建议**：
  - [负责人: 李云锋][截止日期: {due_3}] 跨端联调推进：项目经理协调线上申请参数并打通联调通道。
"""
    return week_header, new_report

def update_weekly_reports_file(md_path, week_header, new_report_content):
    if not md_path.exists():
        header = """# MFTB 集团项目与 mFood 综合版本 周报数据

本文件包含项目的周度汇报数据。编译器 `compile_projects_data.py` 将解析此文件，并将内容嵌入至网页进度看板中。格式请保持 `## [开始日期 至 结束日期]` 及 `### 数字.` 的结构。

---

"""
        md_path.write_text(header + new_report_content, encoding='utf-8')
        return
        
    content = md_path.read_text(encoding='utf-8')
    import re
    parts = re.split(r'^##\s*\[', content, flags=re.MULTILINE)
    header_part = parts[0]
    week_blocks = parts[1:]
    
    replaced = False
    new_blocks = []
    
    for block in week_blocks:
        lines = block.split('\n', 1)
        block_header = lines[0].split(']')[0].strip()
        if block_header == week_header:
            cleaned_report = new_report_content.replace('## [', '', 1)
            new_blocks.append(cleaned_report)
            replaced = True
        else:
            new_blocks.append(block)
            
    if not replaced:
        cleaned_report = new_report_content.replace('## [', '', 1)
        new_blocks.insert(0, cleaned_report)
        
    if not header_part.endswith('\n'):
        header_part += '\n'
    header_part = header_part.rstrip() + '\n\n'
    
    new_content = header_part + '## [' + '## ['.join(new_blocks)
    md_path.write_text(new_content, encoding='utf-8')

def main():
    import sys
    if not YUNXIAO_TOKEN:
        print("ERROR: YUNXIAO_ACCESS_TOKEN environment variable is not set.", file=sys.stderr)
        print("Please configure your Alibaba Cloud DevOps Personal Access Token as an environment variable.", file=sys.stderr)
        sys.exit(1)

    generate_weekly = False
    if '--generate-weekly' in sys.argv:
        generate_weekly = True
        
    # Auto-generate weekly report on Friday after 17:00 Beijing Time (UTC+8)
    from datetime import datetime, timezone, timedelta
    bj_time = datetime.now(timezone(timedelta(hours=8)))
    if bj_time.weekday() == 4 and bj_time.hour >= 17:
        print("Automatically enabling weekly report generation (Friday after 17:00 Beijing Time).")
        generate_weekly = True

    print("Fetching live data from Alibaba Cloud DevOps MCP Server...")
    
    parsed_mftb = fetch_project_items(MFTB_PROJECT_ID, 'MFTB集团项目')
    parsed_mfood = fetch_project_items(MFOOD_PROJECT_ID, 'mFood综合版本')
    
    parsed_latest = {
        'mftb': parsed_mftb,
        'mfood': parsed_mfood
    }

    # 2. Database history tracking and transition updates
    check_and_rebuild_db()
    conn = sqlite3.connect(str(DB_PATH))
    
    # Log transitions for the current fetch
    log_live_workitem_transitions(conn, parsed_latest['mftb'], 'mftb')
    log_live_workitem_transitions(conn, parsed_latest['mfood'], 'mfood')
    
    # Populate missing workitem types for existing transitions
    populate_missing_workitem_types(conn, parsed_latest['mftb'], 'mftb')
    populate_missing_workitem_types(conn, parsed_latest['mfood'], 'mfood')
    
    if generate_weekly:
        print("Generating weekly report draft...")
        week_header, new_report = generate_weekly_report_content(conn, parsed_latest['mftb'], parsed_latest['mfood'])
        update_weekly_reports_file(WEEKLY_REPORTS_PATH, week_header, new_report)
        print(f"Weekly report for {week_header} generated successfully.")

    # Reconstruct history timeline based on creation dates of requirements and tasks
    reconstruct_history_timeline(conn, 'mftb', parsed_latest['mftb'])
    reconstruct_history_timeline(conn, 'mfood', parsed_latest['mfood'])
    
    # Compute lead time KPIs
    kpi_mftb = calculate_lead_time_kpi(conn, 'mftb')
    kpi_mfood = calculate_lead_time_kpi(conn, 'mfood')
    
    conn.close()
    
    # Load history timeline from SQLite
    history_timeline = load_history_from_db()

    # 4. Compile weekly reports
    print("Parsing weekly reports...")
    weekly_reports = parse_weekly_reports(WEEKLY_REPORTS_PATH)
    print(f"Parsed {len(weekly_reports)} weekly report entries.")
        
    # Preserve pmoAdvice if exists in existing projects_data.json
    existing_pmo_advice = {}
    if OUTPUT_PATH.exists():
        try:
            existing_data = json.loads(OUTPUT_PATH.read_text(encoding='utf-8'))
            existing_pmo_advice = existing_data.get('pmoAdvice', {})
        except Exception as e:
            print(f"Warning: failed to load existing data for pmoAdvice preservation: {e}")

    db = {
        'compiledAt': datetime.now(timezone.utc).isoformat(),
        'latest': parsed_latest,
        'history': history_timeline,
        'weeklyReports': weekly_reports,
        'leadTimeKPI': {
            'mftb': kpi_mftb,
            'mfood': kpi_mfood
        },
        'pmoAdvice': existing_pmo_advice
    }
    
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Data compiled successfully. Saved to {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
