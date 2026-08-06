/**
 * QA 缓解对策弹窗模块
 * 包含 QA 测试队列拥堵缓解建议弹窗和 Markdown 周报导出功能
 */

import { state } from '../state/index.js';
import {
    isItemCompleted, inferDeveloperRole, getBusinessLine,
    isCriticalPath, escapeHtml, showToast
} from '../utils/index.js';
import { roleMeta } from '../config/constants.js';
import { getStrategicAdvices } from '../views/risk.js';

/**
 * 展示 QA 缓解对策弹窗
 * 根据当前工作项数据推荐可支援的测试和产品人员，并提供缓解建议
 */
export function showQAMitigationModal() {
    const modal = document.getElementById('qa-mitigation-modal');
    if (!modal) return;

    const items = state.latest[state.currentProject] || [];

    // 动态设置警告提示和标题描述
    const descEl = modal.querySelector('.section-desc');
    if (descEl) {
        descEl.innerHTML = '测试工作专业性强，优先推荐空闲的测试同仁，并建议协调产品协助功能验收测试，避免盲目指派开发人员抢占测试资源。<br><span style="color: var(--color-rose); font-weight: 500; display: block; margin-top: 8px;">*测试工作专业性强，优先推荐空闲的测试同仁，并建议协调产品协助功能验收测试，避免盲目指派开发人员抢占测试资源。</span>';
    }
    const thEl = modal.querySelector('.data-table th:first-child');
    if (thEl) {
        thEl.textContent = '团队成员';
    }

    // 活跃开发任务：非测试中/非已完成的 Task 和 Bug
    const activeDevTasks = items.filter(x => {
        if (x.category !== 'Task' && x.category !== 'Bug') return false;
        if (isItemCompleted(x)) return false;
        const testingStatuses = ['提交测试', '测试中', '待测试', '已提测', '发包已测试'];
        if (testingStatuses.includes(x.status)) return false;
        return true;
    });

    const allAssignees = [...new Set(items.map(x => x.assignee).filter(Boolean))];

    const workload = {};
    allAssignees.forEach(name => {
        workload[name] = 0;
    });
    activeDevTasks.forEach(x => {
        if (x.assignee) {
            workload[x.assignee] = (workload[x.assignee] || 0) + 1;
        }
    });

    const sortedDevs = Object.entries(workload).sort((a, b) => a[1] - b[1]);

    // 筛选并排序：测试人员优先（按负载升序），其次产品人员
    const testers = sortedDevs.filter(([name]) => inferDeveloperRole(name, items) === 'Tester');
    const productMembers = sortedDevs.filter(([name]) => inferDeveloperRole(name, items) === 'Product');
    const recommendedPeople = [...testers, ...productMembers];

    const tbody = document.getElementById('mitigation-devs-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        recommendedPeople.forEach(([name, count]) => {
            const tr = document.createElement('tr');

            let badgeHtml = '';
            if (count <= 1) {
                badgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--color-emerald); border: 1px solid rgba(16, 185, 129, 0.3);">可支援</span>`;
            } else {
                badgeHtml = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid var(--border-color);">繁忙</span>`;
            }

            const role = inferDeveloperRole(name, items);
            const meta = roleMeta[role] || { name: '未知', badge: 'badge-role-other' };
            const roleBadgeHtml = `<span class="badge ${meta.badge}">${meta.name}</span>`;

            const pingLink = `slack://user?name=${encodeURIComponent(name)}`;
            const pingHtml = `<a href="${pingLink}" style="color: var(--color-primary); text-decoration: none;" class="ping-link">💬 Ping on Slack</a>`;

            tr.innerHTML = `
                <td class="cell-title">${escapeHtml(name)}</td>
                <td>${roleBadgeHtml}</td>
                <td>${count} 个</td>
                <td>${badgeHtml}</td>
                <td>${pingHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 渲染缓解建议提示
    const tipsContainer = document.querySelector('.mitigation-tips-list');
    if (tipsContainer) {
        const personA = recommendedPeople[0] ? recommendedPeople[0][0] : '无人员';
        const roleA = recommendedPeople[0] ? inferDeveloperRole(personA, items) : '';
        const roleAName = roleA ? (roleMeta[roleA] || { name: '成员' }).name : '成员';

        const personB = recommendedPeople[1] ? recommendedPeople[1][0] : '无人员';
        const roleB = recommendedPeople[1] ? inferDeveloperRole(personB, items) : '';
        const roleBName = roleB ? (roleMeta[roleB] || { name: '成员' }).name : '成员';

        let mitigationTip = `建议指派负载较低的 <strong>${escapeHtml(personA)}</strong> (${roleAName}) 和 <strong>${escapeHtml(personB)}</strong> (${roleBName}) 支援高优先级任务的测试验证与功能验收。`;

        tipsContainer.innerHTML = `
            <li style="margin-bottom: 6px;"><strong>暂停代码合并</strong>: 建议暂时暂停非关键需求的合码，以减少 QA 测试负担。</li>
            <li style="margin-bottom: 6px;">${mitigationTip}</li>
        `;
    }

    modal.classList.add('active');
    modal.style.display = 'flex';
}

/**
 * 隐藏 QA 缓解对策弹窗
 */
export function hideQAMitigationModal() {
    const modal = document.getElementById('qa-mitigation-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

/**
 * 导出 Markdown 周报 Snippet 到剪贴板
 * 包含项目名称、导出时间、筛选条件、核心数据统计、卡点风险提示和过滤明细表
 */
export function exportMarkdownSnippet() {
    const projectMap = {
        mftb: 'MFTB 集团项目',
        mfood: 'mFood 综合版本'
    };
    const projectName = projectMap[state.currentProject] || state.currentProject;
    const now = new Date();

    const pad = (n) => n.toString().padStart(2, '0');
    const exportTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 读取当前筛选条件
    const searchVal = document.getElementById('filter-search') ? document.getElementById('filter-search').value.trim() : '';
    const categoryVal = document.getElementById('filter-category') ? document.getElementById('filter-category').value : 'all';
    const statusVal = document.getElementById('filter-status') ? document.getElementById('filter-status').value : 'all';
    const assVal = document.getElementById('filter-assignee') ? document.getElementById('filter-assignee').value : 'all';
    const prioVal = document.getElementById('filter-priority') ? document.getElementById('filter-priority').value : 'all';
    const iterVal = document.getElementById('filter-iteration') ? document.getElementById('filter-iteration').value : 'all';
    const bizLineVal = document.getElementById('filter-business-line') ? document.getElementById('filter-business-line').value : 'all';

    const filterStrings = [];
    if (searchVal) filterStrings.push(`搜索: "${searchVal}"`);
    filterStrings.push(`类型: ${categoryVal === 'all' ? '全部类型' : (categoryVal === 'Req' ? '需求' : (categoryVal === 'Task' ? '任务' : '缺陷'))}`);
    filterStrings.push(`状态: ${statusVal === 'all' ? '全部状态' : statusVal}`);
    filterStrings.push(`负责人: ${assVal === 'all' ? '全部负责人' : assVal}`);
    if (prioVal !== 'all' && prioVal !== null) filterStrings.push(`优先级: ${prioVal}`);
    if (iterVal !== 'all' && iterVal !== null) filterStrings.push(`迭代: ${iterVal}`);
    if (bizLineVal !== 'all' && bizLineVal !== null) filterStrings.push(`业务线: ${bizLineVal === 'zhongbao' ? '众包' : bizLineVal === 'daojia' ? '到家业务' : '到店业务'}`);
    const filtersLabel = filterStrings.join(' | ');

    // 过滤工作项
    const items = state.latest[state.currentProject] || [];
    const filtered = items.filter(x => {
        if (searchVal) {
            const matchTitle = x.title.toLowerCase().includes(searchVal.toLowerCase());
            const matchRow = (x.rowText || '').toLowerCase().includes(searchVal.toLowerCase());
            const matchId = (x.id || '').toLowerCase().includes(searchVal.toLowerCase());
            if (!matchTitle && !matchRow && !matchId) return false;
        }
        if (categoryVal !== 'all' && x.category !== categoryVal) return false;
        if (statusVal !== 'all' && x.status !== statusVal) return false;
        if (assVal !== 'all' && x.assignee !== assVal) return false;
        if (prioVal !== 'all' && prioVal !== null && x.priority !== prioVal) return false;
        if (iterVal !== 'all' && iterVal !== null && x.iteration !== iterVal) return false;
        if (bizLineVal !== 'all' && bizLineVal !== null && getBusinessLine(x) !== bizLineVal) return false;
        return true;
    });

    // 统计数据
    const total = filtered.length;
    const completed = filtered.filter(x => isItemCompleted(x)).length;
    const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    const leadTime = (state.leadTimeKPI[state.currentProject] || { average: 0 }).average;

    // 风险消息
    const riskMessages = [];

    const activeTasks = items.filter(x => x.category === 'Task');
    const numeratorList = activeTasks.filter(x => {
        if (!['提交测试', '待测试', '已提测', '发包已测试'].includes(x.status)) return false;
        if (x.status === '提交测试' && x.workItemType !== '測試') return false;
        return true;
    });
    const denominatorList = activeTasks.filter(x => {
        if (!['测试中'].includes(x.status)) return false;
        if (x.status === '测试中' && x.workItemType !== '測試') return false;
        return true;
    });
    const num = numeratorList.length;
    const den = denominatorList.length;

    if (den === 0) {
        if (num > 0) {
            riskMessages.push(`⚠️ 所有测试挂起：测试队列中积压了 ${num} 个任务，但当前无在测任务！请指派测试资源。`);
        }
    } else {
        const ratio = num / den;
        if (ratio > 5.0) {
            riskMessages.push(`⚠️ QA测试队列拥堵：当前提交测试与待测试任务共 ${num} 个，但在测任务仅 ${den} 个，配比为 ${ratio.toFixed(1)} 倍（警告阈值 5.0 倍）！`);
        }
    }

    const baseDate = new Date('2026-06-08T23:59:59');
    const overdueCriticalItems = filtered.filter(x => isCriticalPath(x) && !isItemCompleted(x) && x.planEnd && new Date(x.planEnd + 'T23:59:59') < baseDate);
    overdueCriticalItems.forEach(item => {
        riskMessages.push(`⚠️ 关键路径延期：[${item.id}] ${item.title} 计划完成时间为 ${item.planEnd}，已逾期未完成！`);
    });

    const riskSection = riskMessages.length > 0
        ? riskMessages.map(m => `  - ${m}`).join('\n')
        : '  - 暂无卡点风险提示';

    const advices = getStrategicAdvices(items);
    const adviceLines = advices.length > 0
        ? advices.map(a => `  - ${a.text}`).join('\n')
        : '  - 暂无研发效能卡点与流控建议。';

    // 构建明细表行
    let tableRows = '';
    filtered.forEach(x => {
        const dateLabel = x.planStart ? `${x.planStart} 至 ${x.planEnd || '-'}` : '未排期';
        tableRows += `| ${x.id || '-'} | ${escapeHtml(x.title)} | ${escapeHtml(x.assignee)} | ${x.status || '-'} | ${x.priority || '-'} | ${dateLabel} |\n`;
    });

    const markdown = `### [${projectName}] 研发进度周报
* **导出时间**: ${exportTime}
* **筛选条件**: ${filtersLabel}
* **核心数据统计**:
  - 累计项: ${total} | 已完成/已验证: ${completed} (完成率: ${rate}%)
  - 需求平均交付周期: ${leadTime.toFixed(1)} 天
* **卡点风险提示**: 
${riskSection}

### * 研发效能与流控建议
${adviceLines}

* **过滤明细表**:
  | ID | 标题 | 负责人 | 状态 | 优先级 | 计划时间 |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  ${tableRows.trim()}

---
*Generated by MFTB Collaboration Dashboard | [Give Feedback]*`;

    navigator.clipboard.writeText(markdown).then(() => {
        showToast('已复制周报 Snippet 到剪贴板！');
    }).catch(err => {
        console.error('Failed to copy markdown:', err);
        showToast('复制失败，请手动选择复制。');
    });
}
