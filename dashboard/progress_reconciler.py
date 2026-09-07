import os
import json
import sqlite3
import re
import sys
from datetime import datetime

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

# Module-level zhconv fallback: avoid repeated failed import attempts in hot loops
# If zhconv is not installed, matching still works on original text.
try:
    from zhconv import convert as _zhconv_convert
except Exception:
    _zhconv_convert = lambda text, _: text


def log_progress(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


DB_PATH = 'projects_history.db'
OUTPUT_PATH = 'projects_data.json'

def get_keywords(text):
    text = _zhconv_convert(text, 'zh-hans')
    # Split text into keywords, ignoring punctuation and common stop words
    cleaned = re.sub(r'[^\w\s\u4e00-\u9fff]', ' ', text)
    words = cleaned.split()
    # Filter out short or generic words
    stop_words = {
        '的', '了', '和', '与', '及', '中', '于', '在', '之', '功能', '服务', '接口', '开发', '优化', 
        '支持', '新增', '修改', '查询', '列表', '管理', '平台', '设置', '系统', '信息', '配置', 
        '详情', '页面', '相关', '处理', '数据', '项目', '需求', '中心', '方案', '导出', '导入', 
        '更新', '编辑', '展示', '通用', '默认', '基础', '操作', '组件', '模版', '模板', '大系统'
    }
    return {w.lower() for w in words if len(w) > 1 and w not in stop_words}

def match_items(workitem_id, workitem_title, target_name, target_path=""):
    workitem_title = _zhconv_convert(workitem_title, 'zh-hans')
    target_name = _zhconv_convert(target_name, 'zh-hans')
    if target_path:
        target_path = _zhconv_convert(target_path, 'zh-hans')

    # Manual Override Mappings
    manual_mappings = [
        ("MFTB-75", "/finance/merchant-reconciliation/debt-reconciliation"),
        ("支付渠道", "/finance/payment-manager/payment-setting")
    ]
    for key, path_sub in manual_mappings:
        if (key in workitem_id or key in workitem_title) and (path_sub in target_path or path_sub in target_name):
            return True

    # Fuzzy match logic:
    # 1. Substring match (require substantial length to avoid trivial matches)
    if (len(target_name) >= 4 and target_name in workitem_title) or (len(workitem_title) >= 4 and workitem_title in target_name):
        return True
        
    # 2. Specific route concept translation (only match specific business terms)
    if target_path:
        path_lower = target_path.lower()
        translations = {
            'reconciliation': '对账', 'debt': '欠款', 'settle': '结算',
            'withdraw': '提现', 'refund': '退款', 'deposit': '押金', 
            'commission': '佣金', 'coupon': '红包', 'discount': '优惠',
            'contract': '合同', 'approval': '审批', 'advert': '广告'
        }
        for eng, chi in translations.items():
            if eng in path_lower and chi in workitem_title:
                return True
                
    # 3. Keyword overlap (meaningful domain keywords)
    w_words = get_keywords(workitem_title)
    t_words = get_keywords(target_name)
    overlap = w_words.intersection(t_words)
    if overlap:
        # Check if any overlapping word is a meaningful domain term (length >= 3 or specific 2-char terms)
        for w in overlap:
            if len(w) >= 3 or w in {'红包', '优惠', '商户', '账单', '对账', '核销', '提现', '押金', '配送', '外卖', '团购', '退款', '佣金', '分销', '推广', '极马', '众包'}:
                return True
    return False

def main():
    today_str = datetime.now().strftime('%Y-%m-%d')
    log_progress("Starting Progress Reconciliation...")
    
    # 1. Fetch Admin UI scan results
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT submenu, menu, url, buttons, inputs, smoke_status, error_logs 
    FROM admin_scan_results 
    WHERE scan_date = (SELECT MAX(scan_date) FROM admin_scan_results)
    """)
    admin_rows = cursor.fetchall()
    
    admin_features = []
    for submenu, menu, url, buttons, inputs, smoke_status, error_logs in admin_rows:
        admin_features.append({
            'type': 'UI_Menu',
            'submenu': submenu,
            'name': menu,
            'path': url,
            'buttons': json.loads(buttons),
            'inputs': json.loads(inputs),
            'smoke_status': smoke_status,
            'error_logs': json.loads(error_logs)
        })
        
    # 2. Fetch Apifox endpoint changes (or current endpoints)
    cursor.execute("""
    SELECT project_id, name, method, path, status 
    FROM apifox_endpoints 
    WHERE last_seen = (SELECT MAX(last_seen) FROM apifox_endpoints)
    """)
    apifox_rows = cursor.fetchall()
    
    apifox_features = []
    for project_id, name, method, path, status in apifox_rows:
        apifox_features.append({
            'type': 'API_Endpoint',
            'submenu': f"Apifox Project {project_id}",
            'name': name,
            'path': path,
            'method': method,
            'status': status,
            'smoke_status': 'Passed' # Default passed for documented APIs unless validated otherwise
        })
        
    conn.close()
    
    # 3. Read compiled projects data (Yunxiao workitems)
    # 优先读取 dashboard/data（编译输出 + 最新 pmoAdvice），避免用本地根目录 projects_data.json
    # 中的陈旧 pmoAdvice 覆盖已生成的建议。
    paths_to_read = [
        'alibabacloud-devops-mcp-skill/dashboard/data/projects_data.json',
        'alibabacloud-devops-mcp-skill/dashboard/projects_data.json',
        'repo-temp/dashboard/projects_data.json',
        'projects_data.json'
    ]
    
    projects_data = None
    for p in paths_to_read:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    projects_data = json.load(f)
                break
            except:
                pass
                
    if projects_data is None:
        print("Error: Could not load projects_data.json from any of the standard paths. Run compile_projects_data.py first.")
        sys.exit(1)
        
    latest_items = []
    for proj, items in projects_data.get('latest', {}).items():
        for it in items:
            latest_items.append({
                'project': proj,
                'id': it['id'],
                'title': it['title'],
                'status': it['status'],
                'category': it['category'],
                'assignee': it['assignee'],
                'workItemType': it.get('workItemType', ''),
                'completed': it.get('status') in [
                    '已上线', '已关闭', '测试环境验证通过', '测试环境验收通过',
                    '预发布验收通过', '生产验收通过', '产品验收通过', '已完成',
                    '已关闭（已修复）', '已关闭（未修复）'
                ]
            })
            
    # 4. Reconciliation Engine Matching
    verified_deployed = []
    deployment_incomplete = []
    shadow_development = []
    delivery_delay = []
    mobile_pending = []
    process_milestones = []
    other_projects = []
    
    matched_features = set()
    matched_workitems = set()
    total_items = len(latest_items)
    
    # Map workitems to features
    log_progress(f"开始匹配 workitems 与 features（共 {total_items} 项）...")
    for idx, it in enumerate(latest_items, 1):
        if idx % 200 == 0:
            log_progress(f"  进度: {idx}/{total_items} workitems 已匹配...")
        title_lower = it['title'].lower()
        
        # Check if it belongs to other projects (众包/极马)
        if any(k in title_lower for k in ['【眾包】', '【众包】', '【極馬】', '【极马】']):
            other_projects.append({
                'workitem_id': it['id'],
                'workitem_title': it['title'],
                'workitem_status': it['status'],
                'project': it['project'],
                'assignee': it['assignee']
            })
            continue
            
        matched_admin_for_it = []
        for f in admin_features:
            if match_items(it['id'], it['title'], f['name'], f['path']):
                matched_features.add((f['type'], f['submenu'], f['name']))
                matched_admin_for_it.append(f)
                
        matched_apifox_for_it = []
        for f in apifox_features:
            if match_items(it['id'], it['title'], f['name'], f['path']):
                matched_features.add((f['type'], f['submenu'], f['name']))
                matched_apifox_for_it.append(f)
                
        if matched_admin_for_it:
            it_matched = True
            failed_f = next((f for f in matched_admin_for_it if f['smoke_status'] != 'Passed'), None)
            if failed_f:
                deployment_incomplete.append({
                    'workitem_id': it['id'],
                    'workitem_title': it['title'],
                    'workitem_status': it['status'],
                    'project': it['project'],
                    'feature_type': failed_f['type'],
                    'feature_name': failed_f['name'],
                    'feature_path': failed_f['path'],
                    'smoke_status': failed_f['smoke_status'],
                    'error_logs': failed_f['error_logs']
                })
            else:
                top_f = matched_admin_for_it[0]
                verified_deployed.append({
                    'workitem_id': it['id'],
                    'workitem_title': it['title'],
                    'workitem_status': it['status'],
                    'project': it['project'],
                    'feature_type': top_f['type'],
                    'feature_name': top_f['name'],
                    'feature_path': top_f['path'],
                    'smoke_status': top_f['smoke_status'],
                    'error_logs': top_f['error_logs']
                })
        elif matched_apifox_for_it:
            it_matched = True
            top_f = matched_apifox_for_it[0]
            verified_deployed.append({
                'workitem_id': it['id'],
                'workitem_title': it['title'],
                'workitem_status': it['status'],
                'project': it['project'],
                'feature_type': top_f['type'],
                'feature_name': top_f['name'],
                'feature_path': top_f['path'],
                'smoke_status': top_f['smoke_status'],
                'error_logs': []
            })
        else:
            it_matched = False
                
        if it_matched:
            matched_workitems.add(it['id'])
        else:
            # If the ticket is marked Completed, but no feature/API is found in Admin Panel/Apifox
            if it['completed'] and it['category'] in ['Req', 'Task']:
                title_lower = it['title'].lower()
                project_lower = it['project'].lower()
                
                # Check for Product/Design Process Milestones (by title keywords or Yunxiao workItemType)
                is_process = any(k in title_lower for k in ['【产品】', '【ui】', '【交互】', '【原型】', '【设计】', '【视觉】', '【prd】', '【交互设计】']) or \
                             it.get('workItemType') in ['产品', '设计', 'UI', '交互', 'Product', 'Design', 'UI设计', '产品需求', '设计需求']
                
                # Check for Mobile App tasks
                is_mobile = any(k in title_lower for k in ['【app】', '【ios】', '专题页', '小程序', '【android】', '【安卓】', '【苹果】', '【微信小程序】']) or \
                            any(k in project_lower for k in ['app', 'ios', 'android', 'client'])
                
                item_details = {
                    'workitem_id': it['id'],
                    'workitem_title': it['title'],
                    'workitem_status': it['status'],
                    'project': it['project'],
                    'assignee': it['assignee']
                }
                
                if is_process:
                    process_milestones.append(item_details)
                elif is_mobile:
                    mobile_pending.append(item_details)
                else:
                    delivery_delay.append(item_details)
                
    # 4.5. Generate Three-way Linkage Reconciliation (Task <-> API <-> UI Menu)
    three_way_reconciliation = []
    log_progress(f"开始生成三方联动核对（共 {total_items} 项）...")
    for idx, it in enumerate(latest_items, 1):
        if idx % 200 == 0:
            log_progress(f"  进度: {idx}/{total_items} 三方联动核对...")
        title_lower = it['title'].lower()
        project_lower = it['project'].lower()
        
        # Exclude other projects
        if any(k in title_lower for k in ['【眾包】', '【众包】', '【極馬】', '【极马】']):
            continue
            
        # Exclude process milestones
        is_process = any(k in title_lower for k in ['【产品】', '【ui】', '【交互】', '【原型】', '【设计】', '【视觉】', '【prd】', '【交互设计】']) or \
                     it.get('workItemType') in ['产品', '设计', 'UI', '交互', 'Product', 'Design', 'UI设计', '产品需求', '设计需求']
        if is_process:
            continue
            
        # Exclude mobile app tasks
        is_mobile = any(k in title_lower for k in ['【app】', '【ios】', '专题页', '小程序', '【android】', '【安卓】', '【苹果】', '【微信小程序】']) or \
                    any(k in project_lower for k in ['app', 'ios', 'android', 'client'])
        if is_mobile:
            continue
            
        # Only process Req and Task categories
        if it['category'] not in ['Req', 'Task']:
            continue
            
        # Find matched UIs and APIs
        matched_uis = []
        for f in admin_features:
            if match_items(it['id'], it['title'], f['name'], f['path']):
                matched_uis.append({
                    'name': f['name'],
                    'path': f['path'],
                    'submenu': f['submenu'],
                    'smoke_status': f['smoke_status']
                })
                
        matched_apis = []
        for f in apifox_features:
            if match_items(it['id'], it['title'], f['name'], f['path']):
                matched_apis.append({
                    'name': f['name'],
                    'path': f['path'],
                    'method': f['method'],
                    'status': f['status']
                })
                
        # Classify linkage status
        if len(matched_uis) > 0 and len(matched_apis) > 0:
            any_pass = any(u['smoke_status'] == 'Passed' for u in matched_uis)
            status_key = "both_ready" if any_pass else "smoke_failed"
        elif len(matched_uis) == 0 and len(matched_apis) > 0:
            status_key = "frontend_missing"
        elif len(matched_uis) > 0 and len(matched_apis) == 0:
            status_key = "backend_missing"
        else:
            status_key = "neither_ready"
            
        three_way_reconciliation.append({
            'workitem_id': it['id'],
            'workitem_title': it['title'],
            'workitem_status': it['status'],
            'project': it['project'],
            'assignee': it['assignee'],
            'completed': it['completed'],
            'api_count': len(matched_apis),
            'ui_count': len(matched_uis),
            'apis': matched_apis[:5],
            'uis': matched_uis[:5],
            'status': status_key
        })

    # Detect Shadow Work (UI/API features that have no matching tickets on Yunxiao)
    for f in admin_features:
        if (f['type'], f['submenu'], f['name']) not in matched_features:
            # We ignore core system menus to avoid cluttering shadow work
            if f['submenu'] in ["系统设置", "系统模板", "表单组件", "表单独立组件", "表格组件", "展示组件", "布局设置", "基础设置", "权限管理"]:
                continue
            shadow_development.append({
                'feature_type': f['type'],
                'feature_name': f['name'],
                'feature_path': f['path'],
                'smoke_status': f['smoke_status'],
                'error_logs': f['error_logs']
            })
            
    for f in apifox_features:
        if (f['type'], f['submenu'], f['name']) not in matched_features:
            # Filter out standard CRUD endpoints to focus on custom features
            if any(p in f['path'].lower() for p in ['/list', '/get', '/tree-list', '/delete', '/add', '/edit', '/page']):
                continue
            shadow_development.append({
                'feature_type': f['type'],
                'feature_name': f['name'],
                'feature_path': f['path'],
                'smoke_status': f['smoke_status'],
                'error_logs': []
            })
            
    # 5. Generate PMO Advice Report
    summary = {
        'verifiedCount': len(verified_deployed),
        'incompleteCount': len(deployment_incomplete),
        'shadowCount': len(shadow_development),
        'delayCount': len(delivery_delay),
        'mobileCount': len(mobile_pending),
        'processCount': len(process_milestones),
        'otherCount': len(other_projects)
    }
    
    def generate_reconciliation_advice(summary):
        verified = summary['verifiedCount']
        incomplete = summary['incompleteCount']
        shadow = summary['shadowCount']
        delay = summary['delayCount']
        
        total = verified + incomplete + shadow + delay
        verified_pct = round(verified / total * 100, 1) if total > 0 else 0
        
        lines = []
        lines.append(f"### 🕵️‍♂️ 部署与需求核对报告")
        lines.append(f"核对已完成。系统实测功能与云效工单的匹配一致率为 **{verified_pct}%**。\n")
        
        # Add info about filtered app/process/other tickets
        m_count = summary.get('mobileCount', 0)
        p_count = summary.get('processCount', 0)
        o_count = summary.get('otherCount', 0)
        if m_count > 0 or p_count > 0 or o_count > 0:
            filter_desc = []
            if m_count > 0:
                filter_desc.append(f"**{m_count}** 项移动端App发布任务")
            if p_count > 0:
                filter_desc.append(f"**{p_count}** 项产品方案/UI设计等过程节点工单")
            if o_count > 0:
                filter_desc.append(f"**{o_count}** 项其他项目工单（众包、极马）")
            lines.append(f"> 💡 **管理流审计提示**：为了精准定位“交付堵点”，本周期已将 {"、".join(filter_desc)} 进行分流过滤，将其排除在后端页面/接口的交付滞后率考核之外。\n")
        
        # 核心评估
        lines.append(f"#### 1. 核心态势评估")
        if verified_pct > 85:
            lines.append(f"- **一致性水平良好**：项目实际功能发布与工单登记同步性高，信息滞后风险低。")
        elif verified_pct > 60:
            lines.append(f"- **一致性一般**：存在部分功能部署但未关闭工单，或已部署功能冒烟测试失败，需加强过程审计。")
        else:
            lines.append(f"- **一致性偏低**：检测到较多影子开发（无单上线）或已关闭工单未实际部署，存在严重的信息脱节和发布断点！")
            
        # 待纠偏的重点项目
        lines.append(f"\n#### 2. 交付偏差细节分析")
        if incomplete > 0:
            lines.append(f"- **冒烟失败 (Incomplete) = {incomplete} 项**：页面已上线但抛出 JS 异常或 API 接口请求失败。这通常说明前端与服务端接口契约不一致，或新功能测试不充分。")
        if shadow > 0:
            lines.append(f"- **影子开发 (Shadow) = {shadow} 项**：管理后台已检测到新路由/接口，但云效中无任何关联单据。这说明研发存在脱离项目管理审计的自行开发行为。")
        if delay > 0:
            lines.append(f"- **交付滞后 (Delay) = {delay} 项**：云效工单已标记完成，但实际环境未检测到路由。说明功能卡在发布分支、漏发、或未真正提测。")
            
        # 可执行建议
        lines.append(f"\n#### 3. PM 纠偏行动指南")
        if incomplete > 0:
            lines.append(f"- **行动 1 (质量治理)**：督促研发查看核对面板下方的报错详情，定位 JS 报错堆栈，并在今日内修复使其通过冒烟测试。")
        if shadow > 0:
            lines.append(f"- **行动 2 (流程规范)**：召集负责人对影子接口进行补单（补提需求或 Bug），归入当前迭代，确保所有发布皆可审计。")
        if delay > 0:
            lines.append(f"- **行动 3 (发布确认)**：逐个向负责人核实已标记完成的工单是否漏发或发错分支，安排在下一个窗口重新发布。")
            
        return "\n".join(lines)
        
    advice_text = generate_reconciliation_advice(summary)
    
    # 6. SQLite History Persistence
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reconciliation_advice_history (
        scan_date TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        advice TEXT NOT NULL
    );
    """)
    
    # Write today's record
    current_details = {
        'verified': verified_deployed[:50],
        'incomplete': deployment_incomplete[:30],
        'shadow': shadow_development[:30],
        'delay': delivery_delay[:50],
        'mobile': mobile_pending[:50],
        'process': process_milestones[:50],
        'other': other_projects[:50],
        'threeway': three_way_reconciliation
    }
    cursor.execute("""
    INSERT OR REPLACE INTO reconciliation_advice_history (scan_date, summary, details, advice)
    VALUES (?, ?, ?, ?)
    """, (today_str, json.dumps(summary, ensure_ascii=False), json.dumps(current_details, ensure_ascii=False), advice_text))
    conn.commit()
    
    # Fetch last 15 days history
    cursor.execute("""
    SELECT scan_date, summary, advice 
    FROM reconciliation_advice_history 
    ORDER BY scan_date DESC 
    LIMIT 15
    """)
    history_rows = cursor.fetchall()
    conn.close()
    
    reconciliation_history = []
    for s_date, s_summary, s_advice in history_rows:
        reconciliation_history.append({
            'scan_date': s_date,
            'summary': json.loads(s_summary),
            'advice': s_advice
        })
        
    # 7. Output JSON Structure
    report = {
        'reconciliationReport': {
            'compiledAt': datetime.now().isoformat(),
            'summary': summary,
            'advice': advice_text,
            'details': current_details
        },
        'reconciliationHistory': reconciliation_history
    }
    
    # Save directly into projects_data.json at all potential paths
    projects_data.update(report)
    
    paths_to_write = [
        'projects_data.json',
        'alibabacloud-devops-mcp-skill/dashboard/projects_data.json',
        'alibabacloud-devops-mcp-skill/dashboard/data/projects_data.json',
        'repo-temp/dashboard/projects_data.json',
        'repo-temp/dashboard/data/projects_data.json'
    ]
    
    updated_count = 0
    for p in paths_to_write:
        dir_name = os.path.dirname(p)
        if dir_name and not os.path.exists(dir_name):
            continue
        try:
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(projects_data, f, ensure_ascii=False, indent=2)
            updated_count += 1
        except Exception as write_err:
            pass
            
    print(f"Progress Reconciliation completed! Report updated in {updated_count} location(s).", flush=True)
    print(f"Summary: Verified: {len(verified_deployed)} | Incomplete: {len(deployment_incomplete)} | Shadow: {len(shadow_development)} | Delay: {len(delivery_delay)}", flush=True)

if __name__ == '__main__':
    main()
