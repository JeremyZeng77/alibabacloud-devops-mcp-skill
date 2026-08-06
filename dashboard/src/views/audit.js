/**
 * 协作与进度审计视图模块
 * 包含排期缺失审计、闲置人力审计、排期规范人员审计
 * 使用 VirtualTable 实现大数据量下的虚拟滚动
 */

import { state } from '../state/index.js';
import { escapeHtml, isItemCompleted, formatDate } from '../utils/index.js';
import { DEVELOPER_ROLES_MAP, roleMeta } from '../config/constants.js';
import { VirtualTable } from '../data/virtual-scroll.js';

// 审计视图筛选器状态
export const auditFilters = {
    search: '',
    role: 'all',
    ignoreReq: false
};

// 模块级 VirtualTable 实例缓存
let _auditMissingVT = null;
let _auditIdleVT = null;
let _auditHealthyVT = null;

/**
 * 渲染协作与进度审计视图
 * 三大面板：排期缺失审计、闲置人力审计、排期规范人员审计
 */
export function renderAuditView() {
    const lastUpdatedEl = document.getElementById('audit-last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = state.compiledAt ? formatDate(new Date(state.compiledAt)) : 'N/A';
    }

    const items = state.latest[state.currentProject] || [];
    const searchQuery = auditFilters.search.trim().toLowerCase();
    const selectedRole = auditFilters.role;

    // ── Part A: 排期缺失审计 ──
    const missingDateItems = items.filter(x => {
        if (isItemCompleted(x)) return false;
        if (!x.assignee) return false;

        const allowedCategories = auditFilters.ignoreReq ? ['Task'] : ['Task', 'Req'];
        if (!allowedCategories.includes(x.category)) return false;

        return !x.planStart || !x.planEnd;
    });

    // 按负责人分组
    const missingGroups = {};
    missingDateItems.forEach(item => {
        const name = item.assignee;
        if (!missingGroups[name]) {
            missingGroups[name] = [];
        }
        missingGroups[name].push(item);
    });

    // 按搜索和角色筛选
    const filteredMissingGroups = {};
    Object.entries(missingGroups).forEach(([name, list]) => {
        const roleKey = DEVELOPER_ROLES_MAP[name] || 'Fullstack';
        const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
        const matchesRole = selectedRole === 'all' || roleKey === selectedRole;

        if (matchesSearch && matchesRole) {
            filteredMissingGroups[name] = list;
        }
    });

    // 渲染排期缺失面板（使用 VirtualTable）
    const missingContainer = document.getElementById('audit-missing-dates-container');
    if (missingContainer) {
        const keys = Object.keys(filteredMissingGroups);
        if (keys.length > 0) {
            // 构建虚拟滚动数据数组
            const missingData = keys.map(name => {
                const list = filteredMissingGroups[name];
                const roleKey = DEVELOPER_ROLES_MAP[name] || 'Fullstack';
                const roleName = roleMeta[roleKey] ? roleMeta[roleKey].name : '开发成员';
                return { name, list, roleName };
            });

            // 创建或复用 VirtualTable 实例
            if (!_auditMissingVT) {
                _auditMissingVT = new VirtualTable({
                    container: missingContainer,
                    rowHeight: 64,
                    bufferRows: 3,
                    renderRow: (item) => {
                        const taskLinks = item.list.map(it => {
                            const icon = it.category === 'Req' ? '💬' : (it.category === 'Task' ? '💡' : (it.category === 'Bug' ? '🚨' : ''));
                            return `<span class="message-task-link" onclick="showItemDetailById('${it.id}')" title="点击查看详情">${icon} [${it.id}] ${escapeHtml(it.title.substring(0, 20))}${it.title.length > 20 ? '...' : ''}</span>`;
                        }).join(', ');

                        const div = document.createElement('div');
                        div.className = 'message-item warning vt-row';
                        div.style.overflow = 'hidden';
                        div.innerHTML = `
                            <span class="message-badge badge-warning">排期缺失</span>
                            <strong style="color: var(--color-amber);">${escapeHtml(item.name)} (${item.roleName})</strong>:
                            有 ${item.list.length} 个进行中任务缺少计划时间：${taskLinks}
                        `;
                        return div;
                    }
                });
            }
            _auditMissingVT.setData(missingData);
        } else {
            // 数据为空时销毁 VT 并显示空状态
            if (_auditMissingVT) { _auditMissingVT.destroy(); _auditMissingVT = null; }
            missingContainer.innerHTML = `
                <div class="message-empty success">
                    <span class="message-empty-icon">✅</span>
                    <span>没有符合当前筛选条件的排期缺失记录。</span>
                </div>
            `;
        }
    }

    // ── Part B: 闲置人力审计 ──
    const auditedRoles = ['Frontend', 'Backend', 'Mobile', 'UI', 'Tester', 'Product', 'PM', 'Ops'];
    const idleMembersByRole = {
        Frontend: [], Backend: [], Mobile: [], UI: [], Tester: [], Product: [], PM: [], Ops: []
    };

    // 跨项目全局统计活跃未完成任务数
    const allProjectsItems = [
        ...(state.latest['mftb'] || []),
        ...(state.latest['mfood'] || [])
    ];

    const activeItemCounts = {};
    allProjectsItems.forEach(x => {
        if (x.assignee && !isItemCompleted(x)) {
            activeItemCounts[x.assignee] = (activeItemCounts[x.assignee] || 0) + 1;
        }
    });

    // 查找活跃任务为 0 的人员
    Object.entries(DEVELOPER_ROLES_MAP).forEach(([name, role]) => {
        if (auditedRoles.includes(role)) {
            const activeCount = activeItemCounts[name] || 0;
            if (activeCount === 0) {
                const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
                const matchesRole = selectedRole === 'all' || role === selectedRole;
                if (matchesSearch && matchesRole) {
                    idleMembersByRole[role].push(name);
                }
            }
        }
    });

    // 渲染闲置人力面板（使用 VirtualTable）
    const idleContainer = document.getElementById('audit-idle-members-container');
    if (idleContainer) {
        const totalIdleCount = Object.values(idleMembersByRole).reduce((sum, arr) => sum + arr.length, 0);

        if (totalIdleCount > 0) {
            // 构建虚拟滚动数据数组（按角色分组）
            const idleData = Object.entries(idleMembersByRole)
                .filter(([role, members]) => members.length > 0)
                .map(([role, members]) => ({
                    roleName: roleMeta[role].name,
                    badgeClass: roleMeta[role].badge,
                    members
                }));

            if (!_auditIdleVT) {
                _auditIdleVT = new VirtualTable({
                    container: idleContainer,
                    rowHeight: 52,
                    bufferRows: 3,
                    renderRow: (item) => {
                        const div = document.createElement('div');
                        div.className = 'message-item info vt-row';
                        div.style.overflow = 'hidden';
                        div.innerHTML = `
                            <span class="message-badge ${item.badgeClass}">${item.roleName}</span>
                            <strong>空闲人员 (${item.members.length}人)</strong>:
                            <span style="color: var(--color-text-primary); font-weight: 500;">
                                ${item.members.map(m => escapeHtml(m)).join(', ')}
                            </span>
                        `;
                        return div;
                    }
                });
            }
            _auditIdleVT.setData(idleData);
        } else {
            if (_auditIdleVT) { _auditIdleVT.destroy(); _auditIdleVT = null; }
            idleContainer.innerHTML = `
                <div class="message-empty info">
                    <span class="message-empty-icon">💡</span>
                    <span>没有符合当前筛选条件的空闲人员记录。</span>
                </div>
            `;
        }
    }

    // ── Part C: 排期规范人员审计 ──
    const healthyMembersByRole = {
        Frontend: [], Backend: [], Mobile: [], UI: [], Tester: [], Product: [], PM: [], Ops: []
    };
    const healthyMemberTasks = {};

    Object.entries(DEVELOPER_ROLES_MAP).forEach(([name, role]) => {
        if (auditedRoles.includes(role)) {
            const currentProjectActiveItems = items.filter(x => x.assignee === name && !isItemCompleted(x));
            const activeCount = currentProjectActiveItems.length;

            if (activeCount > 0) {
                const allowedCategories = auditFilters.ignoreReq ? ['Task'] : ['Task', 'Req'];
                const hasMissingDate = currentProjectActiveItems.some(x =>
                    allowedCategories.includes(x.category) && (!x.planStart || !x.planEnd)
                );

                if (!hasMissingDate) {
                    const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
                    const matchesRole = selectedRole === 'all' || role === selectedRole;
                    if (matchesSearch && matchesRole) {
                        healthyMembersByRole[role].push(name);
                        healthyMemberTasks[name] = currentProjectActiveItems;
                    }
                }
            }
        }
    });

    // 渲染排期规范面板（使用 VirtualTable）
    const healthyContainer = document.getElementById('audit-healthy-members-container');
    if (healthyContainer) {
        const totalHealthyCount = Object.values(healthyMembersByRole).reduce((sum, arr) => sum + arr.length, 0);

        if (totalHealthyCount > 0) {
            // 展平为逐人数据数组
            const healthyData = [];
            Object.entries(healthyMembersByRole).forEach(([role, members]) => {
                members.forEach(name => {
                    healthyData.push({
                        name,
                        list: healthyMemberTasks[name],
                        roleName: roleMeta[role].name,
                        badgeClass: roleMeta[role].badge
                    });
                });
            });

            if (!_auditHealthyVT) {
                _auditHealthyVT = new VirtualTable({
                    container: healthyContainer,
                    rowHeight: 64,
                    bufferRows: 3,
                    renderRow: (item) => {
                        const taskLinks = item.list.map(it => {
                            const icon = it.category === 'Req' ? '💬' : (it.category === 'Task' ? '💡' : (it.category === 'Bug' ? '🚨' : ''));
                            return `<span class="message-task-link" onclick="showItemDetailById('${it.id}')" title="点击查看详情" style="color: var(--color-emerald); border-bottom-color: rgba(16, 185, 129, 0.3);">${icon} [${it.id}] ${escapeHtml(it.title.substring(0, 20))}${it.title.length > 20 ? '...' : ''}</span>`;
                        }).join(', ');

                        const div = document.createElement('div');
                        div.className = 'message-item success vt-row';
                        div.style.overflow = 'hidden';
                        div.innerHTML = `
                            <span class="message-badge ${item.badgeClass}" style="background: rgba(16, 185, 129, 0.15); color: var(--color-emerald); border-color: rgba(16, 185, 129, 0.3);">${item.roleName}</span>
                            <strong style="color: var(--color-emerald);">${escapeHtml(item.name)}</strong>:
                            正在负责 ${item.list.length} 个排期规范任务：${taskLinks}
                        `;
                        return div;
                    }
                });
            }
            _auditHealthyVT.setData(healthyData);
        } else {
            if (_auditHealthyVT) { _auditHealthyVT.destroy(); _auditHealthyVT = null; }
            healthyContainer.innerHTML = `
                <div class="message-empty success">
                    <span class="message-empty-icon">💡</span>
                    <span>没有符合当前筛选条件的排期规范开发中人员。</span>
                </div>
            `;
        }
    }
}
