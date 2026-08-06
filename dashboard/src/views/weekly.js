/**
 * 周报与管理建议视图模块
 * 包含周报选择器填充、周报内容渲染、Markdown 解析
 */

import { state } from '../state/index.js';
import { escapeHtml } from '../utils/index.js';

/**
 * 填充周报周期选择器下拉框
 * 按时间倒序排列，恢复上次选择或默认选最新一周
 */
export function populateWeeklySelector() {
    const select = document.getElementById('weekly-week-select');
    const prevValue = select.value;
    select.innerHTML = '';

    if (state.weeklyReports.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '暂无周报记录';
        select.appendChild(opt);
        return;
    }

    state.weeklyReports.forEach((rep) => {
        const opt = document.createElement('option');
        opt.value = rep.week;
        opt.textContent = `周期：${rep.week}`;
        select.appendChild(opt);
    });

    if (prevValue && state.weeklyReports.some(r => r.week === prevValue)) {
        select.value = prevValue;
    } else {
        select.value = state.weeklyReports[0].week;
    }

    renderWeeklyReport(select.value);
}

/**
 * 渲染周报内容
 * @param {string} weekVal - 周报周期标识
 */
export function renderWeeklyReport(weekVal) {
    const projKey = state.currentProject;

    // 渲染 PMO 项目管理建议
    const pmoAdviceContainer = document.getElementById('weekly-pmo-advice-container');
    if (pmoAdviceContainer) {
        const advice = (state.pmoAdvice && state.pmoAdvice[projKey]) ? state.pmoAdvice[projKey] : null;
        if (advice && advice.content && advice.content.trim()) {
            pmoAdviceContainer.style.display = 'block';
            pmoAdviceContainer.innerHTML = `
                <div class="pmo-advice-header">
                    <div class="pmo-advice-title-group">
                        <span class="pmo-advice-icon">💡</span>
                        <h3 class="pmo-advice-title">项目管理建议</h3>
                    </div>
                    <span class="pmo-advice-meta">更新时间：${advice.updatedAt || '刚刚'}</span>
                </div>
                <div class="pmo-advice-content">
                    ${parseNarrativeMarkdown(advice.content)}
                </div>
            `;
        } else {
            pmoAdviceContainer.style.display = 'block';
            pmoAdviceContainer.innerHTML = `
                <div class="pmo-advice-header">
                    <div class="pmo-advice-title-group">
                        <span class="pmo-advice-icon">💡</span>
                        <h3 class="pmo-advice-title">项目管理建议</h3>
                    </div>
                    <span class="pmo-advice-meta">尚未更新</span>
                </div>
                <div class="pmo-advice-empty">
                    暂无今日项目管理建议。系统将在每日 11:30 和 17:30 自动生成并推送最新大盘建议。
                </div>
            `;
        }
    }

    const report = state.weeklyReports.find(r => r.week === weekVal);
    if (!report) {
        ['weekly-progress', 'weekly-planning', 'weekly-assessment', 'weekly-risks', 'weekly-recommendations'].forEach(id => {
            document.getElementById(id).innerHTML = `<div style="color: var(--text-muted)">本周周期暂未编制文字周报</div>`;
        });
        document.getElementById('weekly-metrics-card').style.display = 'none';
        return;
    }

    const projReport = report[projKey] || report;

    // 渲染度量数据卡片
    const metricsCard = document.getElementById('weekly-metrics-card');
    if (projReport.metrics && projReport.metrics.trim() && projReport.metrics.trim() !== '<div style="color: var(--text-muted)">暂无编制</div>') {
        metricsCard.style.display = 'block';
        document.getElementById('weekly-metrics').innerHTML = parseNarrativeMarkdown(projReport.metrics);
    } else {
        metricsCard.style.display = 'none';
    }

    document.getElementById('weekly-progress').innerHTML = parseNarrativeMarkdown(projReport.progress);
    document.getElementById('weekly-planning').innerHTML = parseNarrativeMarkdown(projReport.planning);
    document.getElementById('weekly-assessment').innerHTML = parseNarrativeMarkdown(projReport.assessment);
    document.getElementById('weekly-risks').innerHTML = parseNarrativeMarkdown(projReport.risks, true);

    // 渲染技术管理行动项
    const recContent = document.getElementById('weekly-recommendations');
    const actionItems = projReport.actionItems || [];

    if (actionItems.length > 0) {
        // 计算 AICR（行动项关闭率）
        const completed = actionItems.filter(x => x.completed).length;
        const total = actionItems.length;
        const aicr = total > 0 ? (completed / total * 100) : 0;

        // 注入/更新 AICR 徽章
        const recHeader = document.querySelector('.card-badge-purple');
        if (recHeader) {
            let aicrBadge = recHeader.querySelector('.aicr-badge');
            if (!aicrBadge) {
                aicrBadge = document.createElement('span');
                aicrBadge.className = 'aicr-badge';
                recHeader.appendChild(aicrBadge);
            }
            aicrBadge.style.cssText = 'margin-left: auto; font-size: 13.5px; font-weight: 600; color: var(--color-primary); background: rgba(0, 242, 254, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(0, 242, 254, 0.2);';
            aicrBadge.textContent = `建议落实率 (AICR): ${aicr.toFixed(1)}%`;

            recHeader.style.display = 'flex';
            recHeader.style.alignItems = 'center';
            recHeader.style.width = '100%';
        }

        // 构建行动项表格
        let tableHTML = `
            <table class="weekly-data-table" style="margin-top: 16px;">
                <thead>
                    <tr>
                        <th>建议项 (Action Item)</th>
                        <th style="width: 100px;">负责人</th>
                        <th style="width: 120px;">截止日期</th>
                        <th style="width: 110px;">状态/警报</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const nowTime = new Date('2026-06-08T00:00:00').getTime();

        actionItems.forEach(item => {
            let statusBadge = '';
            if (item.completed) {
                statusBadge = '<span class="badge badge-status-completed">已完成</span>';
            } else {
                const dueTime = new Date(item.due + 'T00:00:00').getTime();
                const diffMs = dueTime - nowTime;
                const diffHours = diffMs / (1000 * 60 * 60);

                if (diffMs < 0) {
                    statusBadge = '<span class="badge badge-status-overdue">已超期</span>';
                } else if (diffHours <= 48) {
                    statusBadge = '<span class="badge badge-status-warn">即将超期</span>';
                } else {
                    statusBadge = '<span class="badge badge-status-progress">进行中</span>';
                }
            }

            tableHTML += `
                <tr>
                    <td style="font-weight: 500; color: var(--text-primary);">${escapeHtml(item.desc)}</td>
                    <td style="color: var(--text-secondary);">${escapeHtml(item.owner)}</td>
                    <td style="color: var(--text-muted); font-family: monospace;">${item.due}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });

        tableHTML += `
                </tbody>
            </table>
        `;

        recContent.innerHTML = tableHTML;
    } else {
        // 无行动项时隐藏 AICR 徽章，渲染原始建议文本
        const recHeader = document.querySelector('.card-badge-purple');
        if (recHeader) {
            const aicrBadge = recHeader.querySelector('.aicr-badge');
            if (aicrBadge) aicrBadge.remove();
        }
        recContent.innerHTML = parseNarrativeMarkdown(projReport.recommendations);
    }
}

/**
 * 简易 Markdown 叙事文本解析器（支持列表、表格、告警标记、加粗）
 * @param {string} text - Markdown 文本
 * @param {boolean} highlightAlerts - 是否高亮告警标记
 * @returns {string} HTML 字符串
 */
export function parseNarrativeMarkdown(text, highlightAlerts = false) {
    if (!text) return '<div style="color: var(--text-muted)">暂无编制</div>';

    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let inTable = false;
    let isFirstRow = true;

    lines.forEach(line => {
        let l = line.trim();
        if (!l) return;

        // 表格行处理（以 | 开头且以 | 结尾）
        if (l.startsWith('|') && l.endsWith('|')) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            if (!inTable) {
                html += '<table class="weekly-data-table">';
                inTable = true;
                isFirstRow = true;
            }

            // 跳过对齐行 | --- | --- |
            if (l.includes('---')) {
                return;
            }

            const cols = l.split('|').map(x => x.trim()).filter((x, idx, arr) => idx > 0 && idx < arr.length - 1);
            html += '<tr>';
            cols.forEach(col => {
                const tag = isFirstRow ? 'th' : 'td';
                html += `<${tag}>${parseInlineStyles(col)}</${tag}>`;
            });
            html += '</tr>';
            isFirstRow = false;
            return;
        }

        // 非表格行时关闭表格
        if (inTable) {
            html += '</table>';
            inTable = false;
        }

        // 检测告警标记 [WARNING] [IMPORTANT] [NOTE]
        let alertClass = '';
        let isAlert = false;
        if (l.startsWith('[WARNING]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[WARNING]', '<strong>⚠️ 警告:</strong>');
        } else if (l.startsWith('[IMPORTANT]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[IMPORTANT]', '<strong>📢 重要提醒:</strong>');
        } else if (l.startsWith('[NOTE]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[NOTE]', '<strong>ℹ️ 备注:</strong>');
        }

        // 列表项处理（以 - 开头）
        if (l.startsWith('-')) {
            if (!inList) {
                html += '<ul class="weekly-bullet-list">';
                inList = true;
            }
            let listContent = l.slice(1).trim();
            listContent = parseInlineStyles(listContent);

            if (isAlert) {
                html += `<li class="${alertClass}">${listContent}</li>`;
            } else {
                html += `<li>${listContent}</li>`;
            }
        } else {
            // 关闭之前的列表
            if (inList) {
                html += '</ul>';
                inList = false;
            }

            let inlineContent = parseInlineStyles(l);
            if (isAlert) {
                html += `<p class="${alertClass}">${inlineContent}</p>`;
            } else {
                html += `<p>${inlineContent}</p>`;
            }
        }
    });

    if (inList) html += '</ul>';
    if (inTable) html += '</table>';
    return html;
}

/**
 * 解析行内样式（**加粗** 转 <strong>）
 * @param {string} text
 * @returns {string}
 */
export function parseInlineStyles(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
