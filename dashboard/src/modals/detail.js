/**
 * 详情弹窗模块
 * 包含工作项详情展示、状态时间线、流转检查清单和评论功能
 * showItemDetailById 暴露到 window 供 HTML onclick 调用
 */

import { state } from '../state/index.js';
import { escapeHtml, getStatusBadgeClass } from '../utils/index.js';
import { CHECKLIST_RULES } from '../config/constants.js';
import { loadCommentsDB, saveCommentDB } from '../data/comments-db.js';

/**
 * 展示工作项详情弹窗
 * 填充弹窗内各字段并激活弹窗
 * @param {Object} item - 工作项对象
 */
export function showItemDetail(item) {
    const categoryName = item.category === 'Req' ? '需求' : (item.category === 'Task' ? '任务' : (item.category === 'Bug' ? '缺陷' : '工作项'));
    document.getElementById('modal-item-id').textContent = `${categoryName}详情 - ${item.id}`;

    const catBadge = item.category === 'Req' ? '<span class="badge-cat badge-cat-req">💭 需求</span>' :
                     item.category === 'Task' ? '<span class="badge-cat badge-cat-task">💡 任务</span>' :
                     item.category === 'Bug' ? '<span class="badge-cat badge-cat-bug">🚨 缺陷</span>' : '';
    document.getElementById('modal-item-title').innerHTML = `${catBadge} ${escapeHtml(item.title)}`;

    document.getElementById('modal-item-status').textContent = item.status;
    document.getElementById('modal-item-status').className = 'field-value badge ' + getStatusBadgeClass(item.status);

    document.getElementById('modal-item-priority').textContent = item.priority;
    document.getElementById('modal-item-priority').className = 'field-value badge badge-prio-' + item.priority;

    document.getElementById('modal-item-assignee').textContent = item.assignee;
    document.getElementById('modal-item-creator').textContent = item.creator;
    document.getElementById('modal-item-iteration').textContent = item.iteration;
    document.getElementById('modal-item-type').textContent = item.workItemType;

    // 填充创建时间和计划日期
    document.getElementById('modal-item-created').textContent = item.createDate || '-';
    document.getElementById('modal-item-start').textContent = item.planStart || '-';
    document.getElementById('modal-item-end').textContent = item.planEnd || '-';

    // 填充终端行文本
    document.getElementById('modal-item-rowtext').textContent = item.rowText;

    // 激活弹窗
    document.getElementById('detail-modal').classList.add('active');
}

/**
 * 通过 ID 或对象展示详情弹窗（兼容两种调用方式）
 * 同时注入状态时间线、检查清单和评论等增强内容
 * 暴露到 window 供 HTML onclick 使用
 * @param {string|Object} itemOrId - 工作项 ID 字符串或工作项对象
 */
export function showItemDetailById(itemOrId) {
    let item = itemOrId;
    let itemId;

    if (typeof itemOrId === 'string') {
        itemId = itemOrId;
        const items = state.latest[state.currentProject] || [];
        item = items.find(x => x.id === itemId);
    } else {
        itemId = itemOrId.id || itemOrId.workitem_id || '';
    }

    if (item) {
        showItemDetail(item);
        // 弹窗打开后延迟注入增强内容
        setTimeout(() => {
            renderStatusTimeline(item);
            renderChecklist(item);
            renderComments(itemId);
        }, 150);
    }
}

// 暴露到全局 window 供 HTML onclick 调用
window.showItemDetailById = showItemDetailById;

/**
 * 隐藏详情弹窗
 */
export function hideModal() {
    document.getElementById('detail-modal').classList.remove('active');
}

/**
 * 渲染状态流转时间线
 * 如无 transitions 数据则构造基于当前状态的简单时间线
 * @param {Object} item - 工作项对象
 */
export function renderStatusTimeline(item) {
    const container = document.getElementById('modal-item-timeline');
    if (!container) return;

    const transitions = item.transitions || item.status_history || [];
    const status = item.status || '未知';

    if (transitions.length === 0) {
        // 构造基于当前状态的简单时间线
        const created = item.created_at || item.created || '';
        const assignee = item.assignee || item.assigned_to || '-';
        container.innerHTML = `<div class="timeline-entry"><div class="timeline-dot"></div><span class="timeline-date">${created ? created.substring(0,10) : '-'}</span><span class="timeline-status">${escapeHtml(status)}</span><span>${escapeHtml(assignee)}</span></div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">提示：详细流转数据需从 history DB 读取。当前显示创建时的状态。</div>`;
        return;
    }

    container.innerHTML = transitions.map(t => {
        const date = t.date || t.created || t.timestamp || '';
        const statusName = t.status || t.to_status || '';
        const user = t.user || t.assignee || t.actor || '';
        return `<div class="timeline-entry"><div class="timeline-dot"></div><span class="timeline-date">${date.length >= 10 ? date.substring(0,10) : date}</span><span class="timeline-status">${escapeHtml(statusName)}</span><span>${escapeHtml(user)}</span></div>`;
    }).join('');
}

/**
 * 渲染流转检查清单
 * 根据工作项状态匹配检查项规则，并恢复已保存的勾选状态
 * @param {Object} item - 工作项对象
 */
export function renderChecklist(item) {
    const container = document.getElementById('modal-item-checklist');
    if (!container) return;

    const status = item.status || '';
    let checkItems = null;

    // 按状态匹配检查项规则
    for (const [key, items] of Object.entries(CHECKLIST_RULES)) {
        if (status.includes(key)) { checkItems = items; break; }
    }
    if (!checkItems) checkItems = CHECKLIST_RULES._default;

    const itemId = String(item.id || item.workitem_id || '');
    const savedChecks = loadChecklistState(itemId);

    container.innerHTML = checkItems.map(ci => {
        const checked = savedChecks[ci.id] ? 'checked' : '';
        return `<div class="checklist-row">
            <input type="checkbox" id="cl-${ci.id}" data-cid="${ci.id}" data-item="${escapeHtml(itemId)}" ${checked}>
            <label for="cl-${ci.id}">${ci.label}</label>
        </div>`;
    }).join('');

    // 绑定勾选事件
    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', function() {
            saveChecklistItem(itemId, this.dataset.cid, this.checked);
        });
    });
}

/**
 * 从 localStorage 加载检查清单勾选状态
 * @param {string} itemId - 工作项 ID
 * @returns {Object} 勾选状态对象
 */
export function loadChecklistState(itemId) {
    try { return JSON.parse(localStorage.getItem('devops_checklist_' + itemId) || '{}'); } catch { return {}; }
}

/**
 * 保存检查清单单项勾选状态到 localStorage
 * @param {string} itemId - 工作项 ID
 * @param {string} checkId - 检查项 ID
 * @param {boolean} checked - 是否勾选
 */
export function saveChecklistItem(itemId, checkId, checked) {
    const state = loadChecklistState(itemId);
    if (checked) state[checkId] = true;
    else delete state[checkId];
    localStorage.setItem('devops_checklist_' + itemId, JSON.stringify(state));
}

/**
 * 渲染评论列表并绑定提交按钮
 * 异步从 IndexedDB 加载评论数据
 * @param {string} itemId - 工作项 ID
 */
export async function renderComments(itemId) {
    const container = document.getElementById('modal-item-comments');
    const input = document.getElementById('modal-comment-input');
    const btn = document.getElementById('btn-modal-comment-submit');
    if (!container) return;

    const comments = await loadComments(itemId);

    container.innerHTML = comments.length === 0
        ? '<p style="color:#94a3b8;font-size:12px;">暂无评论，添加第一条讨论</p>'
        : comments.map(c => `<div class="comment-item"><div class="comment-meta">${escapeHtml(c.author || '匿名')} · ${escapeHtml(c.time || '')}</div><div class="comment-text">${escapeHtml(c.text || '')}</div></div>`).join('');

    if (btn) {
        btn.onclick = async () => {
            const text = input ? input.value.trim() : '';
            if (!text) return;
            await saveComment(itemId, text);
            if (input) input.value = '';
            renderComments(itemId);
        };
    }
}

/**
 * 从 IndexedDB 加载评论列表
 * IndexedDB 不可用时降级到 localStorage
 * @param {string} itemId - 工作项 ID
 * @returns {Promise<Array>} 评论数组
 */
export async function loadComments(itemId) {
    return await loadCommentsDB(itemId);
}

/**
 * 保存评论到 IndexedDB
 * IndexedDB 不可用时降级到 localStorage
 * @param {string} itemId - 工作项 ID
 * @param {string} text - 评论内容
 * @returns {Promise<void>}
 */
export async function saveComment(itemId, text) {
    await saveCommentDB(itemId, text);
}
