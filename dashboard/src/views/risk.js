/**
 * 风险预警中心视图模块
 * 包含风险 KPI、延期预测、依赖检测、人员效能看板、战略建议和风险雷达
 */

import { state } from '../state/index.js';
import {
    isItemCompleted, isCriticalPath, inferDeveloperRole,
    escapeHtml, getBusinessLine
} from '../utils/index.js';
import { loadConfig } from '../config/storage.js';
import { roleMeta } from '../config/constants.js';
import { VirtualTable } from '../data/virtual-scroll.js';

// 模块级 VirtualTable 实例缓存
let _delayTableVT = null;
let _efficiencyTableVT = null;

// 动态导入 QA 缓解弹窗（避免循环依赖）
let _showQAMitigationModal = null;
async function getShowQAMitigationModal() {
    if (!_showQAMitigationModal) {
        const mod = await import('../modals/qa-mitigation.js');
        _showQAMitigationModal = mod.showQAMitigationModal;
    }
    return _showQAMitigationModal;
}

// 动态导入燃尽图（属于 charts 模块）
let _renderBurndownChart = null;
async function getRenderBurndownChart() {
    if (!_renderBurndownChart) {
        const mod = await import('../charts/index.js');
        _renderBurndownChart = mod.renderBurndownChart;
    }
    return _renderBurndownChart;
}

/**
 * 渲染风险预警中心
 * 依次渲染风险 KPI、燃尽图、延期预测、依赖检测、人员效能看板
 */
export function renderRiskCenter() {
    const items = state.latest[state.currentProject] || [];
    const history = state.history[state.currentProject] || [];

    // 风险 KPI
    const delayedItems = findDelayedItems(items, history);
    renderRiskKPIs(items, delayedItems);

    // 燃尽图（异步调用）
    getRenderBurndownChart().then(fn => fn(items, history));

    renderDelayPrediction(delayedItems);
    renderDependencyDetection(items);
    renderEfficiencyBoard(items);
}

/**
 * 查找延期风险工作项
 * 根据创建时间与历史平均周期的比值判定风险等级
 * @param {Array} items - 当前工作项列表
 * @param {Array} history - 历史快照数组
 * @returns {Array} 延期风险项列表（按风险等级排序）
 */
export function findDelayedItems(items, history) {
    const now = new Date();
    const results = [];
    const inactiveStatuses = ['已取消', '已拒绝'];
    const avgCycleDays = computeAvgCycleDays(history, items);

    for (const item of items) {
        const status = item.status || '';
        // 已完成(含Task提交测试)或已取消/已拒绝的不纳入延期检测
        if (isItemCompleted(item)) continue;
        if (inactiveStatuses.some(s => status.includes(s))) continue;

        const created = item.created_at || item.created;
        if (!created) continue;
        const daysSinceCreated = Math.max(0, Math.floor((now - new Date(created)) / 86400000));

        let riskLevel = 'low';
        if (daysSinceCreated > avgCycleDays * 1.5) riskLevel = 'high';
        else if (daysSinceCreated > avgCycleDays) riskLevel = 'medium';

        results.push({ ...item, daysSinceCreated, avgCycleDays, riskLevel });
    }

    results.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.riskLevel] || 3) - (order[b.riskLevel] || 3);
    });
    return results;
}

/**
 * 计算历史平均交付周期（天）
 * @param {Array} history - 历史快照数组
 * @param {Array} items - 当前工作项列表
 * @returns {number} 平均周期天数，无数据时默认 14 天
 */
export function computeAvgCycleDays(history, items) {
    let totalDays = 0, count = 0;

    for (const item of items) {
        if (!isItemCompleted(item)) continue;
        const created = item.created_at || item.created;
        const updated = item.updated_at || item.updated;
        if (created && updated) {
            totalDays += Math.max(1, Math.floor((new Date(updated) - new Date(created)) / 86400000));
            count++;
        }
    }
    return count > 0 ? Math.round(totalDays / count) : 14;
}

/**
 * 渲染风险 KPI 卡片区域
 * @param {Array} items - 当前工作项列表
 * @param {Array} delayedItems - 延期风险项列表
 */
export function renderRiskKPIs(items, delayedItems) {
    const container = document.getElementById('risk-kpi-area');
    if (!container) return;

    const highCount = delayedItems.filter(d => d.riskLevel === 'high').length;
    const medCount = delayedItems.filter(d => d.riskLevel === 'medium').length;
    const total = items.length;
    const completed = items.filter(i => isItemCompleted(i)).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // 预测剩余天数（修复原始代码中 history 未定义的 bug，直接使用 state.history）
    const active = items.filter(i => !isItemCompleted(i) && !['已取消', '已拒绝'].some(s => (i.status || '').includes(s))).length;
    const recentRate = computeRecentVelocity(items);
    const estDays = recentRate > 0 ? Math.round(active / recentRate * 7) : '--';

    container.innerHTML = `<div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#f87171;">${highCount}</div><div class="risk-kpi-label">🔴 高风险延期</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#fbbf24;">${medCount}</div><div class="risk-kpi-label">🟡 中等风险</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#38bdf8;">${active}</div><div class="risk-kpi-label">⚙️ 活跃需求</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#4ade80;">${estDays}天</div><div class="risk-kpi-label">📅 预计完成(按速率)</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#c084fc;">${rate}%</div><div class="risk-kpi-label">📊 交付率</div></div>`;
}

/**
 * 计算近期交付速率（最近 30 天完成数 / 30 天）
 * @param {Array} items - 当前工作项列表
 * @returns {number} 每天完成项数
 */
export function computeRecentVelocity(items) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000);
    let completed = 0;
    for (const item of items) {
        if (!isItemCompleted(item)) continue;
        const updated = item.updated_at || item.updated;
        if (updated && new Date(updated) >= thirtyDaysAgo) completed++;
    }
    return completed > 0 ? (completed / 30) : 0;
}

/**
 * 渲染延期预测表
 * 使用 VirtualTable 实现大数据量虚拟滚动
 * @param {Array} delayedItems - 延期风险项列表
 */
export function renderDelayPrediction(delayedItems) {
    const container = document.getElementById('risk-delay-table-container');
    if (!container) return;

    if (delayedItems.length === 0) {
        if (_delayTableVT) { _delayTableVT.destroy(); _delayTableVT = null; }
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">✅ 当前没有延期风险需求</p>';
        return;
    }

    // 创建表格结构（thead 固定 + tbody 虚拟滚动）
    container.innerHTML = `<table class="dep-table vt-scroll-table"><thead><tr>
        <th>ID</th><th>标题</th><th>负责人</th><th>状态</th><th>已耗时</th><th>历史均值</th><th>风险</th>
    </tr></thead><tbody></tbody></table>`;

    const tbody = container.querySelector('tbody');

    // 创建或复用 VirtualTable 实例
    if (_delayTableVT) { _delayTableVT.destroy(); _delayTableVT = null; }
    _delayTableVT = new VirtualTable({
        container: tbody,
        rowHeight: 44,
        bufferRows: 5,
        renderRow: (d) => {
            const riskClass = d.riskLevel === 'high' ? 'high' : (d.riskLevel === 'medium' ? 'medium' : 'low');
            const riskLabel = d.riskLevel === 'high' ? '高风险' : (d.riskLevel === 'medium' ? '中风险' : '低风险');
            const id = d.id || d.workitem_id || '-';
            const title = (d.title || d.subject || '-').substring(0, 60);
            const assignee = d.assignee || d.assigned_to || '-';
            const status = d.status || '-';
            const days = d.daysSinceCreated || 0;
            const avg = d.avgCycleDays || 0;

            const tr = document.createElement('tr');
            tr.className = 'vt-row';
            tr.innerHTML = `
                <td><span class="dep-table clickable" data-wid="${escapeHtml(String(id))}">${escapeHtml(String(id))}</span></td>
                <td>${escapeHtml(title)}</td>
                <td>${escapeHtml(assignee)}</td>
                <td>${escapeHtml(status)}</td>
                <td>${days}天</td>
                <td>${avg}天</td>
                <td><span class="risk-badge ${riskClass}">${riskLabel}</span></td>
            `;
            return tr;
        }
    });
    _delayTableVT.setData(delayedItems);

    // 事件委托：点击 ID 打开详情（委托到 container，避免逐行绑定）
    container.addEventListener('click', _onDelayTableClick);
}

/** 延期预测表点击事件处理器（事件委托） */
function _onDelayTableClick(e) {
    const el = e.target.closest('.clickable[data-wid]');
    if (!el) return;
    const wid = el.dataset.wid;
    const item = (state.latest[state.currentProject] || []).find(i => String(i.id || i.workitem_id || '') === wid);
    if (item && typeof window.showItemDetailById === 'function') window.showItemDetailById(item);
}

/**
 * 渲染依赖检测面板
 * 检测标题中包含关键路径关键字的工作项完成状态
 * @param {Array} items - 当前工作项列表
 */
export function renderDependencyDetection(items) {
    const container = document.getElementById('risk-dependency-container');
    if (!container) return;

    const criticalKeywords = loadConfig('criticalKeywords', ['支付', '下单', '结算', '登录', '核心', '主流程']);
    const dependencies = [];

    for (const item of items) {
        const title = (item.title || item.subject || '').toLowerCase();
        for (const kw of criticalKeywords) {
            if (title.includes(kw.toLowerCase())) {
                const status = item.status || '';
                const isDone = isItemCompleted(item);
                dependencies.push({
                    id: item.id || item.workitem_id,
                    title: item.title || item.subject || '-',
                    status,
                    isDone,
                    keyword: kw,
                    assignee: item.assignee || '-'
                });
                break;
            }
        }
    }

    if (dependencies.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">未检测到关键路径依赖项（可在配置管理中设置关键字）</p>';
        return;
    }

    const undones = dependencies.filter(d => !d.isDone);
    const dones = dependencies.filter(d => d.isDone);

    container.innerHTML = `
    <div style="margin-bottom:12px;"><span style="color:#f87171;font-weight:600;">⚠️ 未完成 ${undones.length}</span> / 总计 ${dependencies.length} 项关键依赖</div>
    <table class="dep-table"><thead><tr><th>ID</th><th>标题</th><th>状态</th><th>关键字</th><th>负责人</th><th>风险</th></tr></thead><tbody>
        ${[...undones, ...dones].map(d => {
            const riskBadge = d.isDone ? '<span class="risk-badge low">已完成</span>' : '<span class="risk-badge high">未完成</span>';
            return `<tr>
                <td><span class="dep-table clickable" data-wid="${escapeHtml(String(d.id))}">${escapeHtml(String(d.id))}</span></td>
                <td>${escapeHtml((d.title || '').substring(0, 40))}</td>
                <td>${escapeHtml(d.status)}</td>
                <td><span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(d.keyword)}</span></td>
                <td>${escapeHtml(d.assignee)}</td>
                <td>${riskBadge}</td>
            </tr>`;
        }).join('')}
    </tbody></table>`;

    container.querySelectorAll('.clickable[data-wid]').forEach(el => {
        el.addEventListener('click', () => {
            const wid = el.dataset.wid;
            const item = items.find(i => String(i.id || i.workitem_id || '') === wid);
            if (item && typeof window.showItemDetailById === 'function') window.showItemDetailById(item);
        });
    });
}

/**
 * 渲染人员效能看板
 * 统计各成员的总需求、已完成、活跃中、延期项和完成率
 * @param {Array} items - 当前工作项列表
 */
export function renderEfficiencyBoard(items) {
    const container = document.getElementById('risk-efficiency-table-container');
    if (!container) return;

    const devMap = {};
    for (const item of items) {
        const assignee = item.assignee || item.assigned_to || '未指派';
        if (!devMap[assignee]) devMap[assignee] = { name: assignee, total: 0, completed: 0, delayed: 0, active: 0 };
        devMap[assignee].total++;

        const status = item.status || '';
        if (isItemCompleted(item)) {
            devMap[assignee].completed++;
        } else if (!['已取消', '已拒绝'].some(s => status.includes(s))) {
            devMap[assignee].active++;
        }

        const created = item.created_at || item.created;
        if (created && !isItemCompleted(item) && !['已取消', '已拒绝'].some(s => status.includes(s))) {
            const days = Math.floor((new Date() - new Date(created)) / 86400000);
            if (days > 14) devMap[assignee].delayed++;
        }
    }

    const devs = Object.values(devMap).sort((a, b) => b.total - a.total);

    if (devs.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">暂无数据</p>';
        return;
    }

    container.innerHTML = `<table class="dep-table"><thead><tr>
        <th>成员</th><th>总需求</th><th>已完成</th><th>活跃中</th><th>延期项</th><th>完成率</th>
    </tr></thead><tbody>${devs.map(d => {
        const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        const delayedClass = d.delayed > 0 ? 'color:#f87171' : '';
        return `<tr>
            <td style="font-weight:500;">${escapeHtml(d.name)}</td>
            <td>${d.total}</td>
            <td style="color:#4ade80;">${d.completed}</td>
            <td>${d.active}</td>
            <td style="${delayedClass}">${d.delayed}</td>
            <td>${rate}%</td>
        </tr>`;
    }).join('')}</tbody></table>`;
}

/**
 * 生成战略建议列表
 * 基于 QA 瓶颈、前后端负载、移动端负载、UI 设计负载等多维度启发式规则
 * @param {Array} items - 当前工作项列表
 * @returns {Array} 建议对象数组
 */
export function getStrategicAdvices(items) {
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

    let qaAlertActive = false;
    if (den === 0) {
        if (num > 0) qaAlertActive = true;
    } else {
        const ratio = num / den;
        if (ratio > 5.0) qaAlertActive = true;
    }

    const activeItems = items.filter(x => !isItemCompleted(x));
    const assignees = [...new Set(items.map(x => x.assignee).filter(Boolean))];
    const workload = {};
    assignees.forEach(name => {
        workload[name] = 0;
    });
    activeItems.forEach(x => {
        if (x.assignee) {
            workload[x.assignee] = (workload[x.assignee] || 0) + 1;
        }
    });

    let feTotalActive = 0, feCount = 0;
    let beTotalActive = 0, beCount = 0;
    let mobileTotalActive = 0, mobileCount = 0;
    let uiTotalActive = 0, uiCount = 0;

    assignees.forEach(name => {
        const role = inferDeveloperRole(name, items);
        const count = workload[name] || 0;
        if (role === 'Frontend') {
            feTotalActive += count;
            feCount++;
        } else if (role === 'Backend') {
            beTotalActive += count;
            beCount++;
        } else if (role === 'Mobile') {
            mobileTotalActive += count;
            mobileCount++;
        } else if (role === 'UI') {
            uiTotalActive += count;
            uiCount++;
        }
    });

    const FE_avg = feCount > 0 ? (feTotalActive / feCount) : 0;
    const BE_avg = beCount > 0 ? (beTotalActive / beCount) : 0;
    const Mobile_avg = mobileCount > 0 ? (mobileTotalActive / mobileCount) : 0;
    const UI_avg = uiCount > 0 ? (uiTotalActive / uiCount) : 0;

    // UI 任务密度预警
    const uiActiveTasks = activeItems.filter(x => {
        const isUiDev = x.assignee && inferDeveloperRole(x.assignee, items) === 'UI';
        const hasUiKeywords = /ui|设计|切图|样机|交互/i.test((x.title || '') + ' ' + (x.category || ''));
        return isUiDev || hasUiKeywords;
    });
    const UI_count = uiActiveTasks.length;

    const advices = [];

    // 规则 1: 后端拥堵
    if (BE_avg > 3.0 && FE_avg < 1.5) {
        advices.push({
            type: 'jam-be',
            text: `⚠️ 服务端研发拥堵：后端开发人均负荷为 ${BE_avg.toFixed(1)} 个活跃任务，前端为 ${FE_avg.toFixed(1)}。建议产品（Product）与项目经理（PM）暂停输出后端依赖型需求，并放缓新功能排期。`
        });
    }

    // 规则 2: 前端拥堵
    if (FE_avg > 3.0 && BE_avg < 1.5) {
        advices.push({
            type: 'jam-fe',
            text: `⚠️ 前端研发拥堵：前端开发人均负荷为 ${FE_avg.toFixed(1)} 个活跃任务，后端为 ${BE_avg.toFixed(1)}。建议后端适当放缓开发，集中资源协助前端联调、修复Bug或进行代码走查。`
        });
    }

    // 规则 3: 移动端发布拥堵
    if (Mobile_avg > 3.0 && num > 5) {
        advices.push({
            type: 'jam-mobile',
            text: `⚠️ 移动端发布拥堵：移动端人均负荷为 ${Mobile_avg.toFixed(1)} 且测试队列拥堵。建议产品放缓App版本特性发布，优先安排热修复或已有缺陷的验证上线。`
        });
    }

    // 规则 4: UI 设计阻塞
    if (UI_count > 4 && FE_avg < 1.5) {
        advices.push({
            type: 'jam-ui',
            text: `⚠️ UI设计阻塞：UI设计在排任务积压达 ${UI_count} 个，导致前端开发无图可用。建议项目经理（PM）紧急协调设计资源，或让产品与后端开发优先推进非UI依赖的底层逻辑。`
        });
    }

    // 规则 5: QA 与前端拥堵，后端与产品空闲
    if (qaAlertActive && FE_avg > 2.5 && BE_avg < 1.0) {
        advices.push({
            type: 'jam-double',
            text: `⚠️ 研发中下游阻塞：当前测试队列阻塞且前端负荷高，但后端及产品人员空闲。建议产品与项目经理优先将工作重心转移至"纯后端重构型"或"数据库/性能优化"需求的预研与排期。`
        });
    }

    // 规则 6: 后端资源闲置
    if (BE_avg < 1.0 && beCount > 0) {
        advices.push({
            type: 'idle-be',
            text: `⚠️ 服务端资源闲置：后端开发人均负荷仅为 ${BE_avg.toFixed(1)} 个活跃任务。建议项目经理与产品人员加速后端接口与需求排期，或合理安排人员进行技术债清理、慢SQL优化与微服务架构重构。`
        });
    }

    // 规则 7: 前端资源闲置
    if (FE_avg < 1.0 && feCount > 0) {
        advices.push({
            type: 'idle-fe',
            text: `⚠️ 前端资源闲置：前端开发人均负荷仅为 ${FE_avg.toFixed(1)} 个活跃任务。建议项目经理加速UI设计图输出，或向前推进前端通用组件库整理、前端工程化升级与体验优化预研。`
        });
    }

    // 规则 8: 移动端资源闲置
    if (Mobile_avg < 1.0 && mobileCount > 0) {
        advices.push({
            type: 'idle-mobile',
            text: `⚠️ 移动端资源闲置：移动端开发人均负荷仅为 ${Mobile_avg.toFixed(1)} 个活跃任务。建议安排热修复包整理、跨平台技术升级或移动端核心代码模块重构。`
        });
    }

    // 规则 9: UI 设计资源闲置
    if (UI_avg < 1.0 && uiCount > 0) {
        advices.push({
            type: 'idle-ui',
            text: `⚠️ UI设计资源闲置：UI设计人均负荷仅为 ${UI_avg.toFixed(1)} 个活跃任务。建议产品提前输出后续迭代的原型图并与之进行评审，以便交互与视觉设计能更早介入。`
        });
    }

    return advices;
}

/**
 * 渲染战略建议面板
 * @param {Array} items - 当前工作项列表
 */
export function renderStrategicAdvices(items) {
    const container = document.getElementById('strategic-advice-panel');
    if (!container) return;
    container.innerHTML = '';

    const advices = getStrategicAdvices(items);
    advices.forEach(adv => {
        const card = document.createElement('div');
        card.className = `strategic-advice-card ${adv.type}`;
        card.innerHTML = `
            <div class="strategic-advice-icon">💡</div>
            <div class="strategic-advice-text">${escapeHtml(adv.text)}</div>
        `;
        container.appendChild(card);
    });
}

/**
 * 渲染风险雷达预警面板
 * 检测 QA 测试队列拥堵和关键路径延期，并渲染战略建议
 * @param {Array} items - 当前工作项列表
 */
export function renderRiskRadar(items) {
    const container = document.getElementById('risk-radar-alerts');
    if (!container) return;

    container.innerHTML = '';

    // 1. QA 瓶颈检测
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

    let qaAlertHtml = '';
    if (den === 0) {
        if (num > 0) {
            qaAlertHtml = `
                <div class="alert-text-block" style="display: flex; justify-content: space-between; align-items: center; border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.1); color: var(--color-amber);">
                    <span>⚠️ 所有测试挂起：测试队列中积压了 ${num} 个任务，但当前无在测任务！请指派测试资源。</span>
                    <button id="btn-propose-mitigation" class="btn-sync" style="padding: 4px 12px; font-size: 11px; margin-left: 10px;">查看缓解对策</button>
                </div>
            `;
        }
    } else {
        const ratio = num / den;
        if (ratio > 5.0) {
            qaAlertHtml = `
                <div class="alert-text-block" style="display: flex; justify-content: space-between; align-items: center; border-color: rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.1); color: var(--color-rose);">
                    <span>⚠️ QA测试队列拥堵：当前提交测试与待测试任务共 ${num} 个，但在测任务仅 ${den} 个，配比为 ${ratio.toFixed(1)} 倍（警告阈值 5.0 倍）！</span>
                    <button id="btn-propose-mitigation" class="btn-sync" style="padding: 4px 12px; font-size: 11px; margin-left: 10px;">查看缓解对策</button>
                </div>
            `;
        }
    }

    if (qaAlertHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = qaAlertHtml;
        container.appendChild(tempDiv.firstElementChild);

        // 绑定缓解对策按钮点击事件
        const btn = container.querySelector('#btn-propose-mitigation');
        if (btn) {
            btn.addEventListener('click', async () => {
                const showQAMitigationModal = await getShowQAMitigationModal();
                showQAMitigationModal();
            });
        }
    }

    // 2. 关键路径延期检测
    const baseDate = new Date('2026-06-08T23:59:59');
    const overdueCriticalItems = items.filter(x => isCriticalPath(x) && !isItemCompleted(x) && x.planEnd && new Date(x.planEnd + 'T23:59:59') < baseDate);

    overdueCriticalItems.forEach(item => {
        const delayAlertHtml = `
            <div class="alert-text-block" style="display: flex; align-items: center; border-color: rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.08); color: var(--color-rose);">
                <span>⚠️ 关键路径延期：[${item.id}] ${escapeHtml(item.title)} 计划完成时间为 ${item.planEnd}，已逾期未完成！</span>
            </div>
        `;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = delayAlertHtml;
        container.appendChild(tempDiv.firstElementChild);
    });

    // 渲染战略建议面板
    renderStrategicAdvices(items);
}
