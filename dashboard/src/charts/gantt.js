/**
 * 甘特图引擎模块
 * 渲染全员任务计划甘特图，支持日/周/月视图、时间线平移、角色筛选和业务线筛选
 * 性能优化：DocumentFragment 批量构建、rAF 分块渲染、列缓存、事件委托
 */

import { state } from '../state/index.js';
import {
    isItemCompleted, isSameDay, getWeekNumber, isCurrentWeek, isCurrentMonth,
    inferDeveloperRole, getBusinessLine, escapeHtml
} from '../utils/index.js';
import { DEVELOPER_ROLES_MAP, milestonesConfig } from '../config/constants.js';

// 动态导入详情弹窗（避免循环依赖）
let _showItemDetail = null;
async function getShowItemDetail() {
    if (!_showItemDetail) {
        const mod = await import('../modals/detail.js');
        _showItemDetail = mod.showItemDetail;
    }
    return _showItemDetail;
}

/** 甘特图列元数据缓存（避免重复计算列信息） */
let _ganttColsCache = null;

/** 甘特图分块渲染每块大小（负责人数量） */
const GANTT_CHUNK_SIZE = 5;

/**
 * 初始化甘特图状态
 * 设置默认视图模式为日视图，类别为需求
 */
export function initGanttState() {
    state.ganttViewMode = 'day';
    state.ganttCategory = 'Req';
    setGanttViewMode('day');
}

/**
 * 设置甘特图视图模式并调整时间窗口起始日期
 * @param {string} mode - 视图模式: 'day' | 'week' | 'month'
 */
export function setGanttViewMode(mode) {
    state.ganttViewMode = mode;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (mode === 'day') {
        // 日视图：起始日期为今天前 4 天
        const start = new Date(today);
        start.setDate(today.getDate() - 4);
        state.ganttStartDate = start;
    } else if (mode === 'week') {
        // 周视图：起始日期对齐到本周一，再回退 2 周
        const start = new Date(today);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(start.setDate(diff));
        monday.setDate(monday.getDate() - 14);
        state.ganttStartDate = monday;
    } else if (mode === 'month') {
        // 月视图：起始日期为上个月 1 号
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        state.ganttStartDate = start;
    }
}

/**
 * 平移甘特图时间窗口
 * @param {number} direction - 平移方向: -1 向前 | 1 向后
 */
export function shiftGanttTimeline(direction) {
    const start = new Date(state.ganttStartDate);
    if (state.ganttViewMode === 'day') {
        start.setDate(start.getDate() + direction * 7);
    } else if (state.ganttViewMode === 'week') {
        start.setDate(start.getDate() + direction * 28);
    } else if (state.ganttViewMode === 'month') {
        start.setMonth(start.getMonth() + direction * 2);
    }
    state.ganttStartDate = start;
    renderGanttChart();
}

/**
 * 渲染甘特图
 * 包含时间线表头、网格背景、今日标线、里程碑标线、负责人分组和任务条
 * 使用 rAF 分块渲染（每帧渲染 GANTT_CHUNK_SIZE 个负责人）和事件委托优化性能
 */
export async function renderGanttChart() {
    const container = document.getElementById('gantt-grid-container');
    if (!container) return;

    const items = state.latest[state.currentProject] || [];

    // 根据活跃模式过滤
    const activeFiltered = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // 按甘特图类别过滤
    const categoryItems = activeFiltered.filter(x => x.category === state.ganttCategory);

    // 按角色筛选
    const roleSelect = document.getElementById('gantt-role-select');
    const selectedRole = roleSelect ? roleSelect.value : 'all';

    const roleFiltered = selectedRole === 'all'
        ? categoryItems
        : categoryItems.filter(item => inferDeveloperRole(item.assignee, items) === selectedRole);

    // 按业务线筛选
    const ganttBizSelect = document.getElementById('gantt-bizline-select');
    const ganttBizLine = ganttBizSelect ? ganttBizSelect.value : 'all';
    const bizFiltered = ganttBizLine === 'all'
        ? roleFiltered
        : roleFiltered.filter(item => getBusinessLine(item) === ganttBizLine);

    // 映射并计算计划日期
    const ganttItems = bizFiltered.map(item => {
        const planStart = item.planStart || item.createDate;
        const planEnd = item.planEnd || planStart;
        return {
            ...item,
            planStart,
            planEnd,
            originalItem: item
        };
    }).filter(x => x.planStart);

    // 根据视图模式生成列元数据（使用缓存避免重复计算）
    const cols = [];
    const start = new Date(state.ganttStartDate);
    let viewStart, viewEnd;

    if (state.ganttViewMode === 'day') {
        const numCols = 24;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            cols.push({
                date: d,
                label: d.getDate(),
                sublabel: (d.getMonth() + 1) + '月',
                isToday: isSameDay(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        viewEnd = cols[numCols - 1].date.getTime() + 86400000 - 1;
    } else if (state.ganttViewMode === 'week') {
        const numCols = 12;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i * 7);
            cols.push({
                date: d,
                label: 'W' + getWeekNumber(d),
                sublabel: (d.getMonth() + 1) + '/' + d.getDate(),
                isToday: isCurrentWeek(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        viewEnd = cols[numCols - 1].date.getTime() + 7 * 86400000 - 1;
    } else if (state.ganttViewMode === 'month') {
        const numCols = 6;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
            cols.push({
                date: d,
                label: (d.getMonth() + 1) + '月',
                sublabel: d.getFullYear(),
                isToday: isCurrentMonth(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        const lastColEnd = new Date(cols[numCols - 1].date.getFullYear(), cols[numCols - 1].date.getMonth() + 1, 1);
        viewEnd = lastColEnd.getTime() - 1;
    }

    // 缓存列元数据
    _ganttColsCache = { cols, viewStart, viewEnd };

    const viewDuration = viewEnd - viewStart;

    // 过滤掉完全不在可视窗口内的甘特项
    const visibleGanttItems = ganttItems.filter(item => {
        const itemStart = new Date(item.planStart + ' 00:00:00').getTime();
        const itemEnd = new Date((item.planEnd || item.planStart) + ' 23:59:59').getTime();
        return !(itemEnd < viewStart || itemStart > viewEnd);
    });

    // 清空容器并创建结构
    container.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'gantt-layout';

    // 左侧面板（负责人信息）
    const leftPanel = document.createElement('div');
    leftPanel.className = 'gantt-left-panel';
    leftPanel.innerHTML = `<div class="gantt-header-cell">负责人</div>`;

    const assigneesList = document.createElement('div');
    assigneesList.className = 'gantt-assignees-list';

    // 右侧面板（时间线网格和任务条）
    const rightPanel = document.createElement('div');
    rightPanel.className = 'gantt-right-panel';

    const timelineHeader = document.createElement('div');
    timelineHeader.className = 'gantt-timeline-header';

    // 添加列头（使用 DocumentFragment 批量构建）
    const headerFrag = document.createDocumentFragment();
    cols.forEach(col => {
        const colDiv = document.createElement('div');
        colDiv.className = 'gantt-col-header' + (col.isToday ? ' today' : '');
        colDiv.innerHTML = `
            <span class="day-num">${col.label}</span>
            <span class="month-lbl">${col.sublabel}</span>
        `;
        headerFrag.appendChild(colDiv);
    });
    timelineHeader.appendChild(headerFrag);
    rightPanel.appendChild(timelineHeader);

    const timelineRows = document.createElement('div');
    timelineRows.className = 'gantt-timeline-rows';

    // 添加网格背景列线（使用 DocumentFragment）
    const gridBg = document.createElement('div');
    gridBg.className = 'gantt-grid-background';
    const gridFrag = document.createDocumentFragment();
    cols.forEach(col => {
        const colBg = document.createElement('div');
        colBg.className = 'gantt-grid-col' + (col.isToday ? ' today' : '');
        gridFrag.appendChild(colBg);
    });
    gridBg.appendChild(gridFrag);
    timelineRows.appendChild(gridBg);

    // 添加今日垂直标线
    const nowTime = new Date().getTime();
    if (nowTime >= viewStart && nowTime <= viewEnd) {
        const todayLinePercent = ((nowTime - viewStart) / viewDuration) * 100;
        const todayLine = document.createElement('div');
        todayLine.className = 'gantt-today-line';
        todayLine.style.left = todayLinePercent + '%';
        timelineRows.appendChild(todayLine);
    }

    // 渲染里程碑垂直标线
    const milestones = milestonesConfig[state.currentProject] || [];
    milestones.forEach(m => {
        const tMilestone = new Date(m.date + ' 00:00:00').getTime();
        if (tMilestone >= viewStart && tMilestone <= viewEnd) {
            const leftPercent = ((tMilestone - viewStart) / viewDuration) * 100;
            const releaseLine = document.createElement('div');
            releaseLine.className = 'gantt-release-line';
            releaseLine.style.left = leftPercent + '%';
            releaseLine.innerHTML = `
                <div class="release-line-marker"></div>
                <div class="release-tooltip">
                    <span class="milestone-name" style="font-weight: 600; color: #fff;">${escapeHtml(m.name)}</span>
                    <span class="milestone-date" style="color: var(--color-primary);">${m.date}</span>
                </div>
            `;
            timelineRows.appendChild(releaseLine);
        }
    });

    // 预加载详情弹窗函数（避免在循环内重复 await）
    const showItemDetail = await getShowItemDetail();

    // 事件委托：点击甘特图条打开详情（避免逐条绑定 click 事件）
    timelineRows.addEventListener('click', (e) => {
        const bar = e.target.closest('.gantt-bar');
        if (!bar) return;
        const itemId = bar.dataset.itemId;
        if (!itemId) return;
        const allItems = state.latest[state.currentProject] || [];
        const item = allItems.find(i => String(i.id || i.workitem_id || '') === itemId);
        if (item) showItemDetail(item);
    });

    // 按负责人分组可见项
    const groups = {};
    visibleGanttItems.forEach(item => {
        const name = item.assignee || '未指派';
        groups[name] = groups[name] || [];
        groups[name].push(item);
    });

    const activeAssignees = Object.keys(groups).sort();
    const idleAssignees = [];
    for (const [name, role] of Object.entries(DEVELOPER_ROLES_MAP)) {
        if (selectedRole === 'all' || role === selectedRole) {
            if (!groups[name]) {
                idleAssignees.push(name);
            }
        }
    }
    idleAssignees.sort();

    const assigneeNames = [...activeAssignees, ...idleAssignees];

    if (assigneeNames.length === 0) {
        // 渲染空占位行
        const emptyRowLeft = document.createElement('div');
        emptyRowLeft.className = 'gantt-assignee-row';
        emptyRowLeft.innerHTML = `<span class="gantt-assignee-name" style="color: var(--text-muted);">暂无排期</span>`;
        assigneesList.appendChild(emptyRowLeft);

        const emptyRowRight = document.createElement('div');
        emptyRowRight.className = 'gantt-timeline-row';
        emptyRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 12px; color: var(--text-muted); z-index: 5;">当前时间窗口内无进行中任务计划</div>`;
        timelineRows.appendChild(emptyRowRight);
    } else {
        // 分块渲染：每次 requestAnimationFrame 渲染 GANTT_CHUNK_SIZE 个负责人
        let _chunkIndex = 0;

        function _renderGanttChunk() {
            if (_chunkIndex >= assigneeNames.length) return;

            const chunkEnd = Math.min(_chunkIndex + GANTT_CHUNK_SIZE, assigneeNames.length);
            // 使用 DocumentFragment 批量构建，减少 reflow
            const fragLeft = document.createDocumentFragment();
            const fragRight = document.createDocumentFragment();

            for (let ci = _chunkIndex; ci < chunkEnd; ci++) {
                const name = assigneeNames[ci];
                const assigneeItems = groups[name] || [];

                if (assigneeItems.length === 0) {
                    // 渲染闲置成员行
                    const headerRowLeft = document.createElement('div');
                    headerRowLeft.className = 'gantt-assignee-row';
                    headerRowLeft.style.background = 'rgba(255, 255, 255, 0.01)';
                    headerRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
                    headerRowLeft.innerHTML = `
                        <span style="font-size: 10px; color: var(--text-muted); margin-right: 4px; visibility: hidden;">▶</span>
                        <div class="gantt-avatar" style="opacity: 0.5; background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); color: var(--text-muted);">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
                        <span class="gantt-assignee-name" style="font-weight: 500; color: var(--text-muted);">${escapeHtml(name)} <span style="color: var(--text-muted); font-size: 11px;">(0项)</span></span>
                    `;
                    fragLeft.appendChild(headerRowLeft);

                    const headerRowRight = document.createElement('div');
                    headerRowRight.className = 'gantt-timeline-row';
                    headerRowRight.style.background = 'rgba(255, 255, 255, 0.01)';
                    headerRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
                    headerRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 11px; color: var(--text-muted); z-index: 5; font-style: italic;">暂无分配工作项 (闲置)</div>`;
                    fragRight.appendChild(headerRowRight);
                    continue;
                }

                // 稳定排序：planStart(升序) → planEnd(升序) → id(升序)
                assigneeItems.sort((a, b) => {
                    const sA = new Date(a.planStart + ' 00:00:00').getTime();
                    const sB = new Date(b.planStart + ' 00:00:00').getTime();
                    if (sA !== sB) return sA - sB;

                    const eA = new Date((a.planEnd || a.planStart) + ' 23:59:59').getTime();
                    const eB = new Date((b.planEnd || b.planStart) + ' 23:59:59').getTime();
                    if (eA !== eB) return eA - eB;

                    return a.id.localeCompare(b.id);
                });

                // 贪心泳道分配
                const lanes = [];
                const overlaps = (item1, item2) => {
                    const s1 = new Date(item1.planStart + ' 00:00:00').getTime();
                    const e1 = new Date((item1.planEnd || item1.planStart) + ' 23:59:59').getTime();
                    const s2 = new Date(item2.planStart + ' 00:00:00').getTime();
                    const e2 = new Date((item2.planEnd || item2.planStart) + ' 23:59:59').getTime();
                    return s1 <= e2 && s2 <= e1;
                };

                assigneeItems.forEach(item => {
                    let allocated = false;
                    for (let i = 0; i < lanes.length; i++) {
                        const lane = lanes[i];
                        if (!lane.some(laneItem => overlaps(laneItem, item))) {
                            lane.push(item);
                            allocated = true;
                            break;
                        }
                    }
                    if (!allocated) {
                        lanes.push([item]);
                    }
                });

                const isExpanded = state.ganttExpandedAssignees[name] !== false;

                // 手风琴头部行
                const headerRowLeft = document.createElement('div');
                headerRowLeft.className = 'gantt-assignee-row';
                headerRowLeft.style.cursor = 'pointer';
                headerRowLeft.style.background = 'rgba(255, 255, 255, 0.02)';
                headerRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';
                headerRowLeft.innerHTML = `
                    <span style="font-size: 10px; color: var(--color-primary); margin-right: 4px;">${isExpanded ? '▼' : '▶'}</span>
                    <div class="gantt-avatar">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
                    <span class="gantt-assignee-name" style="font-weight: 600;">${escapeHtml(name)} <span style="color: var(--text-muted); font-size: 11px;">(${assigneeItems.length}项)</span></span>
                `;
                headerRowLeft.addEventListener('click', () => {
                    state.ganttExpandedAssignees[name] = !isExpanded;
                    renderGanttChart();
                });
                fragLeft.appendChild(headerRowLeft);

                const headerRowRight = document.createElement('div');
                headerRowRight.className = 'gantt-timeline-row';
                headerRowRight.style.cursor = 'pointer';
                headerRowRight.style.background = 'rgba(255, 255, 255, 0.02)';
                headerRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';
                headerRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 11.5px; color: var(--text-muted); z-index: 5;">点击展开/收起排期明细</div>`;
                headerRowRight.addEventListener('click', () => {
                    state.ganttExpandedAssignees[name] = !isExpanded;
                    renderGanttChart();
                });
                fragRight.appendChild(headerRowRight);

                if (isExpanded) {
                    lanes.forEach((laneItems, laneIndex) => {
                        const laneRowLeft = document.createElement('div');
                        laneRowLeft.className = 'gantt-assignee-row';
                        laneRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
                        laneRowLeft.style.paddingLeft = '32px';
                        laneRowLeft.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">└ Lane ${laneIndex + 1}</span>`;
                        fragLeft.appendChild(laneRowLeft);

                        const laneRowRight = document.createElement('div');
                        laneRowRight.className = 'gantt-timeline-row';
                        laneRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';

                        laneItems.forEach(item => {
                            const itemStart = new Date(item.planStart + ' 00:00:00').getTime();
                            const itemEnd = new Date((item.planEnd || item.planStart) + ' 23:59:59').getTime();

                            const drawStart = Math.max(itemStart, viewStart);
                            const drawEnd = Math.min(itemEnd, viewEnd);

                            const left = ((drawStart - viewStart) / viewDuration) * 100;
                            let width = ((drawEnd - drawStart) / viewDuration) * 100;
                            if (width < 1.2) width = 1.2;

                            const charCount = item.title.length + 25;
                            const estimatedPxWidth = (width / 100) * 1000;
                            const isTextOverflow = (charCount * 6.5) > estimatedPxWidth;

                            const bar = document.createElement('div');
                            bar.className = `gantt-bar category-${item.category}` + (isTextOverflow ? ' text-overflow' : '');
                            bar.style.left = left + '%';
                            bar.style.width = width + '%';
                            // 存储 item ID 供事件委托使用
                            bar.dataset.itemId = String(item.id || item.workitem_id || '');

                            let labelTextPrefix = '';
                            if (isItemCompleted(item)) {
                                labelTextPrefix += '✓ ';
                            } else {
                                labelTextPrefix += '▶ ';
                            }

                            const dateLabel = `${item.planStart.slice(5)}至${(item.planEnd || item.planStart).slice(5)}`;
                            const typeLabel = item.workItemType ? `[${item.workItemType}]` : '';
                            bar.innerHTML = `
                                <span class="gantt-bar-text" title="${escapeHtml(item.title)} (${item.planStart} ~ ${item.planEnd})">
                                    ${labelTextPrefix}${dateLabel} ${typeLabel} ${escapeHtml(item.title)}
                                </span>
                            `;

                            // 点击事件通过 timelineRows 上的事件委托处理，无需逐条绑定
                            laneRowRight.appendChild(bar);
                        });

                        fragRight.appendChild(laneRowRight);
                    });
                }
            }

            // 批量插入 DOM（DocumentFragment 一次性 append，减少 reflow）
            assigneesList.appendChild(fragLeft);
            timelineRows.appendChild(fragRight);

            _chunkIndex = chunkEnd;
            // 还有剩余负责人时，在下一帧继续渲染
            if (_chunkIndex < assigneeNames.length) {
                requestAnimationFrame(_renderGanttChunk);
            }
        }

        // 启动分块渲染
        _renderGanttChunk();
    }

    leftPanel.appendChild(assigneesList);
    rightPanel.appendChild(timelineRows);

    layout.appendChild(leftPanel);
    layout.appendChild(rightPanel);
    container.appendChild(layout);
}
