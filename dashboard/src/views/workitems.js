/**
 * 需求明细列表视图模块
 * 包含筛选器填充、过滤渲染和视图分发器
 */

import { state } from '../state/index.js';
import { escapeHtml, getBusinessLine } from '../utils/index.js';
import { VirtualTable } from '../data/virtual-scroll.js';

// 动态导入其他视图渲染函数
let _viewFns = null;
async function getViewFns() {
    if (!_viewFns) {
        const [overview, weekly, audit, risk, config] = await Promise.all([
            import('./overview.js'),
            import('./weekly.js'),
            import('./audit.js'),
            import('./risk.js'),
            import('./config.js')
        ]);
        _viewFns = {
            renderOverviewDashboard: overview.renderOverviewDashboard,
            populateWeeklySelector: weekly.populateWeeklySelector,
            renderAuditView: audit.renderAuditView,
            renderRiskCenter: risk.renderRiskCenter,
            renderConfigCenter: config.renderConfigCenter
        };
    }
    return _viewFns;
}

// 动态导入详情弹窗
let _showItemDetail = null;
async function getShowItemDetail() {
    if (!_showItemDetail) {
        const mod = await import('../modals/detail.js');
        _showItemDetail = mod.showItemDetail;
    }
    return _showItemDetail;
}

// 动态导入 loader 的 updateTimestamps
let _updateTimestamps = null;
async function getUpdateTimestamps() {
    if (!_updateTimestamps) {
        const mod = await import('../data/loader.js');
        _updateTimestamps = mod.updateTimestamps;
    }
    return _updateTimestamps;
}

/**
 * 视图分发器：根据 state.currentView 调用对应视图的渲染函数
 */
export async function renderCurrentView() {
    const updateTimestamps = await getUpdateTimestamps();
    updateTimestamps();

    if (state.currentView === 'overview') {
        const fns = await getViewFns();
        fns.renderOverviewDashboard();
    } else if (state.currentView === 'workitems') {
        populateFilters();
        applyFilters();
    } else if (state.currentView === 'weekly') {
        const fns = await getViewFns();
        fns.populateWeeklySelector();
    } else if (state.currentView === 'audit') {
        const fns = await getViewFns();
        fns.renderAuditView();
    } else if (state.currentView === 'risk') {
        const fns = await getViewFns();
        fns.renderRiskCenter();
    } else if (state.currentView === 'config') {
        const fns = await getViewFns();
        fns.renderConfigCenter();
    }
}

/**
 * 填充筛选器下拉选项
 * 根据 URL 参数恢复筛选状态，动态生成状态/负责人/迭代选项
 */
export function populateFilters() {
    const allItems = state.latest[state.currentProject] || [];

    // 从 URL 参数恢复搜索和类别
    if (state.urlFilters) {
        if (state.urlFilters.search !== null) {
            const searchEl = document.getElementById('filter-search');
            if (searchEl) searchEl.value = state.urlFilters.search;
        }
        if (state.urlFilters.category !== null) {
            const catEl = document.getElementById('filter-category');
            if (catEl) catEl.value = state.urlFilters.category;
        }
    }

    const categoryVal = document.getElementById('filter-category').value;
    const items = categoryVal === 'all' ? allItems : allItems.filter(x => x.category === categoryVal);

    // 状态筛选
    const statusSelect = document.getElementById('filter-status');
    let prevStatus = statusSelect.value;
    if (state.urlFilters && state.urlFilters.status !== null) {
        prevStatus = state.urlFilters.status;
    }
    statusSelect.innerHTML = '<option value="all">全部状态</option>';
    const statuses = [...new Set(items.map(x => x.status))].filter(Boolean);
    statuses.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        statusSelect.appendChild(opt);
    });
    statusSelect.value = prevStatus && statuses.includes(prevStatus) ? prevStatus : 'all';

    // 负责人筛选
    const assSelect = document.getElementById('filter-assignee');
    let prevAss = assSelect.value;
    if (state.urlFilters && state.urlFilters.assignee !== null) {
        prevAss = state.urlFilters.assignee;
    }
    assSelect.innerHTML = '<option value="all">全部负责人</option>';
    const assignees = [...new Set(items.map(x => x.assignee))].filter(Boolean);
    assignees.forEach(ass => {
        const opt = document.createElement('option');
        opt.value = ass;
        opt.textContent = ass;
        assSelect.appendChild(opt);
    });
    assSelect.value = prevAss && assignees.includes(prevAss) ? prevAss : 'all';

    // 优先级筛选
    if (state.urlFilters && state.urlFilters.priority !== null) {
        const prioSelect = document.getElementById('filter-priority');
        if (prioSelect) prioSelect.value = state.urlFilters.priority;
    }

    // 迭代筛选
    const iterSelect = document.getElementById('filter-iteration');
    let prevIter = iterSelect.value;
    if (state.urlFilters && state.urlFilters.iteration !== null) {
        prevIter = state.urlFilters.iteration;
    }
    iterSelect.innerHTML = '<option value="all">全部迭代</option>';
    const iterations = [...new Set(items.map(x => x.iteration))].filter(Boolean);
    iterations.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it;
        opt.textContent = it;
        iterSelect.appendChild(opt);
    });
    iterSelect.value = prevIter && iterations.includes(prevIter) ? prevIter : 'all';

    // 业务线筛选
    const bizSelect = document.getElementById('filter-business-line');
    if (bizSelect && state.urlFilters && state.urlFilters.bizline !== null) {
        bizSelect.value = state.urlFilters.bizline;
    }

    // 清空 URL 筛选临时存储
    state.urlFilters = null;
}

/**
 * 应用筛选条件并渲染表格
 */
export async function applyFilters() {
    // 动态重建下拉选项
    populateFilters();

    const items = state.latest[state.currentProject] || [];
    const searchVal = document.getElementById('filter-search').value.toLowerCase().trim();
    const categoryVal = document.getElementById('filter-category').value;
    const statusVal = document.getElementById('filter-status').value;
    const assVal = document.getElementById('filter-assignee').value;
    const prioVal = document.getElementById('filter-priority').value;
    const iterVal = document.getElementById('filter-iteration').value;
    const bizVal = document.getElementById('filter-business-line') ? document.getElementById('filter-business-line').value : 'all';

    const filtered = items.filter(x => {
        if (searchVal) {
            const matchTitle = x.title.toLowerCase().includes(searchVal);
            const matchRow = (x.rowText || '').toLowerCase().includes(searchVal);
            const matchId = (x.id || '').toLowerCase().includes(searchVal);
            if (!matchTitle && !matchRow && !matchId) return false;
        }
        if (categoryVal !== 'all' && x.category !== categoryVal) return false;
        if (statusVal !== 'all' && x.status !== statusVal) return false;
        if (assVal !== 'all' && x.assignee !== assVal) return false;
        if (prioVal !== 'all' && x.priority !== prioVal) return false;
        if (iterVal !== 'all' && x.iteration !== iterVal) return false;
        if (bizVal !== 'all' && getBusinessLine(x) !== bizVal) return false;
        return true;
    });

    const categoryText = categoryVal === 'Req' ? '需求' : (categoryVal === 'Task' ? '任务' : (categoryVal === 'Bug' ? '缺陷' : '工作项'));
    document.getElementById('filtered-count-text').textContent = `共找到 ${filtered.length} 条符合条件的${categoryText}`;

    // 动态更新表头
    const tableHeader = document.querySelector('#table-workitems th:nth-child(2)');
    if (tableHeader) {
        tableHeader.textContent = categoryVal === 'Req' ? '需求标题' : (categoryVal === 'Task' ? '任务标题' : (categoryVal === 'Bug' ? '缺陷标题' : '标题'));
    }

    const tbody = document.getElementById('table-tbody');

    if (filtered.length === 0) {
        // 销毁已有 VirtualTable 实例
        if (_workitemsVT) { _workitemsVT.destroy(); _workitemsVT = null; }
        tbody.innerHTML = '';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px 0;">未找到符合过滤条件的数据项目</td>`;
        tbody.appendChild(tr);
        return;
    }

    const fallbackPrefix = categoryVal === 'Req' ? 'REQ-' : (categoryVal === 'Task' ? 'TASK-' : (categoryVal === 'Bug' ? 'BUG-' : 'ID-'));
    const showItemDetail = await getShowItemDetail();

    // 创建或复用 VirtualTable 实例
    if (!_workitemsVT) {
        _workitemsVT = new VirtualTable({
            container: tbody,
            rowHeight: 52,
            bufferRows: 5,
            renderRow: (item, index) => {
                const tr = document.createElement('tr');
                tr.className = 'vt-row';
                tr.addEventListener('click', () => showItemDetail(item));

                const prioBadge = `<span class="badge badge-prio-${item.priority}">${item.priority}</span>`;

                let statusClass = 'badge-status-pending';
                const completedList = ['已上线', '已关闭', '生产验收通过', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'];
                const testingList = ['测试中', '待测试', '提交测试', '发包已测试', '已提测'];
                const progressList = ['开发中', '待开发', '待处理', '方案设计中', '产品方案已确认', '处理中', '设计中', '需产品梳理/确认'];

                if (completedList.includes(item.status)) statusClass = 'badge-status-completed';
                else if (testingList.includes(item.status)) statusClass = 'badge-status-testing';
                else if (progressList.includes(item.status)) statusClass = 'badge-status-progress';
                else if (item.status === '开发挂起' || item.status === '挂起' || item.status === '暂不修复') statusClass = 'badge-status-blocked';

                const statusBadge = `<span class="badge ${statusClass}">${item.status}</span>`;

                let bizBadge = '';
                const biz = getBusinessLine(item);
                if (biz === 'zhongbao') bizBadge = '<span class="badge-biz badge-biz-zhongbao">🏍️ 众包</span>';
                else if (biz === 'daojia') bizBadge = '<span class="badge-biz badge-biz-daojia">🏠 到家</span>';
                else if (biz === 'daodian') bizBadge = '<span class="badge-biz badge-biz-daodian">🏪 到店</span>';

                tr.innerHTML = `
                    <td class="cell-id" style="font-family: monospace; color: var(--color-primary);">${item.id || fallbackPrefix + (index + 1)}</td>
                    <td class="cell-title">
                        ${item.category === 'Req' ? '<span class="badge-cat badge-cat-req">💭 需求</span>' :
                          item.category === 'Task' ? '<span class="badge-cat badge-cat-task">💡 任务</span>' :
                          item.category === 'Bug' ? '<span class="badge-cat badge-cat-bug">🚨 缺陷</span>' : ''}
                        ${bizBadge}
                        ${escapeHtml(item.title)}
                    </td>
                    <td>${statusBadge}</td>
                    <td>${prioBadge}</td>
                    <td style="color: var(--text-secondary);">${escapeHtml(item.assignee)}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(item.creator)}</td>
                    <td><span style="font-size: 11px; background: rgba(255,255,255,0.03); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${escapeHtml(item.iteration)}</span></td>
                    <td style="color: var(--text-muted); font-size: 12px;">${item.createDate || '-'}</td>
                `;
                return tr;
            }
        });
    }

    _workitemsVT.setData(filtered);
}

/** 工作项列表 VirtualTable 实例（模块级缓存） */
let _workitemsVT = null;
