import sys
import json
import pathlib
import re
import os
import subprocess
from datetime import datetime
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')

# Constants for Alibaba Cloud DevOps (Yunxiao) API
YUNXIAO_TOKEN = os.environ.get("YUNXIAO_ACCESS_TOKEN", "pt-hbuL3md0vFTHlhfm191BSaUA_16254f72-7380-45da-8f06-c53de065d0c8")
ORG_ID = os.environ.get("YUNXIAO_ORG_ID", "5f1ac684769820a3e817ed55")
MFTB_PROJECT_ID = "ea6df73257b27472177527f38b"
MFOOD_PROJECT_ID = "b213ecf2c319097885faf16704"

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CAPTURES_PATH = pathlib.Path(r'C:\Users\DELL\.openclaw\workspace-gemma-chat\state\project-bridge\page-captures.jsonl')
WEEKLY_REPORTS_PATH = SCRIPT_DIR / 'weekly_reports.md'
OUTPUT_PATH = SCRIPT_DIR / 'projects_data.json'

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
        
        process = subprocess.Popen(
            ["npx", "-y", "alibabacloud-devops-mcp-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            env=env,
            shell=True
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

def main():
    print("Fetching live data from Alibaba Cloud DevOps MCP Server...")
    
    parsed_mftb = fetch_project_items(MFTB_PROJECT_ID, 'MFTB集团项目')
    parsed_mfood = fetch_project_items(MFOOD_PROJECT_ID, 'mFood综合版本')
    
    parsed_latest = {
        'mftb': parsed_mftb,
        'mfood': parsed_mfood
    }

    # 2. Preserve/Rebuild History
    history_timeline = {
        'mftb': [],
        'mfood': []
    }
    
    loaded_history = False
    
    # Try reading history from existing projects_data.json
    if OUTPUT_PATH.exists():
        try:
            old_db = json.loads(OUTPUT_PATH.read_text(encoding='utf-8'))
            if 'history' in old_db:
                history_timeline = old_db['history']
                loaded_history = True
                print("Loaded historical timeline from existing projects_data.json.")
        except Exception:
            pass
            
    # Fallback to page-captures.jsonl if projects_data.json history couldn't be loaded
    if not loaded_history and CAPTURES_PATH.exists():
        print("Existing history not found. Rebuilding history from page-captures.jsonl...")
        daily_snapshots = { 'mftb': {}, 'mfood': {} }
        
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
                
        # Helper to map items derived from capture formats
        def parse_capture_item(item, proj):
            # Fallback legacy parser
            title = item.get('title', '').strip()
            row = item.get('rowText', '')
            status = item.get('status') or ''
            for st in completed_status_list + ['待处理', '开发中', '测试中']:
                if st in row:
                    status = st
                    break
            if not status: status = '待处理'
            return {'status': status}

        # Build MFTB history
        for d_str in sorted(daily_snapshots['mftb'].keys()):
            items = daily_snapshots['mftb'][d_str]
            p_items = [parse_capture_item(it, 'MFTB集团项目') for it in items]
            status_counts = dict(Counter([it['status'] for it in p_items]))
            completed = sum(v for k, v in status_counts.items() if k in completed_status_list)
            history_timeline['mftb'].append({
                'date': d_str,
                'total': len(p_items),
                'completed': completed,
                'statusCounts': status_counts
            })
            
        # Build mFood history
        for d_str in sorted(daily_snapshots['mfood'].keys()):
            items = daily_snapshots['mfood'][d_str]
            p_items = [parse_capture_item(it, 'mFood综合版本') for it in items]
            status_counts = dict(Counter([it['status'] for it in p_items]))
            completed = sum(v for k, v in status_counts.items() if k in completed_status_list)
            history_timeline['mfood'].append({
                'date': d_str,
                'total': len(p_items),
                'completed': completed,
                'statusCounts': status_counts
            })
        print(f"Rebuilt history from captures. Days: MFTB={len(history_timeline['mftb'])}, mFood={len(history_timeline['mfood'])}.")
        
    # 3. Append current day stats to the history timeline
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    # Helper to append live snapshot to history list
    def append_today_history(proj_key, parsed_items):
        timeline = history_timeline[proj_key]
        task_items = [it for it in parsed_items if it.get('category') == 'Task']
        status_counts = dict(Counter([it['status'] for it in task_items]))
        total = len(task_items)
        completed = sum(v for k, v in status_counts.items() if k in completed_status_list or k in testing_status_list)
        
        # Overwrite if today already exists, otherwise append
        today_entry = next((x for x in timeline if x['date'] == today_str), None)
        if today_entry:
            today_entry['total'] = total
            today_entry['completed'] = completed
            today_entry['statusCounts'] = status_counts
        else:
            timeline.append({
                'date': today_str,
                'total': total,
                'completed': completed,
                'statusCounts': status_counts
            })
            
    append_today_history('mftb', parsed_latest['mftb'])
    append_today_history('mfood', parsed_latest['mfood'])

    # 4. Compile weekly reports
    print("Parsing weekly reports...")
    weekly_reports = parse_weekly_reports(WEEKLY_REPORTS_PATH)
    print(f"Parsed {len(weekly_reports)} weekly report entries.")
        
    db = {
        'compiledAt': datetime.now().isoformat(),
        'latest': parsed_latest,
        'history': history_timeline,
        'weeklyReports': weekly_reports
    }
    
    OUTPUT_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Data compiled successfully. Saved to {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
