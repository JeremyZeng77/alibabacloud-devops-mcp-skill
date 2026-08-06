/**
 * 应用入口模块
 * 负责初始化应用、绑定全局事件监听和管理登录门控
 */

import { state, syncStateToURL } from './state/index.js';
import { checkSession, handleLoginSubmit, handleLogout, initSessionActivityListener, loadAuthConfig } from './auth/session.js';
import { loadDashboardData, pollDashboardData, triggerSyncCompile } from './data/loader.js';
import { initAutoSync } from './data/sync.js';
import { initGanttState, setGanttViewMode, shiftGanttTimeline, renderGanttChart } from './charts/gantt.js';
import { renderStatusChart, renderTypeChart, renderWorkloadChart } from './charts/index.js';
import { renderCurrentView, applyFilters } from './views/workitems.js';
import { renderWeeklyReport } from './views/weekly.js';
import { auditFilters, renderAuditView } from './views/audit.js';
import { hideModal } from './modals/detail.js';
import { hideQAMitigationModal, exportMarkdownSnippet } from './modals/qa-mitigation.js';
import { getUpdateNotifier } from './data/update-notifier.js';
import { initCommentsDB, migrateCommentsFromLocalStorage } from './data/comments-db.js';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/** 启动看板应用主流程 */
export async function startDashboardApp() {
    initGanttState();
    initEventListeners();
    initSessionActivityListener();
    initAutoSync();
    // 初始化 IndexedDB 并迁移 localStorage 中的评论数据
    await initCommentsDB();
    await migrateCommentsFromLocalStorage();
    await loadDashboardData();
    if (!state.pollingIntervalId) {
        state.pollingIntervalId = setInterval(pollDashboardData, 60000);
    }
}

/** 绑定所有全局 DOM 事件监听器 */
function initEventListeners() {
    // 项目切换标签
    $$('.project-tab').forEach(tab => tab.addEventListener('click', e => {
        $$('.project-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.currentProject = e.currentTarget.dataset.project;
        syncStateToURL();
        renderCurrentView();
    }));

    // 视图导航标签
    $$('.nav-tab').forEach(tab => tab.addEventListener('click', e => {
        $$('.nav-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.currentView = e.currentTarget.dataset.view;
        syncStateToURL();
        $$('.view-section').forEach(s => s.classList.remove('active'));
        $(`view-${state.currentView}`).classList.add('active');
        // 标记当前视图已查看（清除 Tab 红点徽标）
        getUpdateNotifier().markViewSeen(state.currentView);
        renderCurrentView();
    }));

    // 编译同步按钮
    $('btn-sync-compile').addEventListener('click', triggerSyncCompile);

    // 关闭详情弹窗
    $('btn-close-modal').addEventListener('click', hideModal);
    $('detail-modal').addEventListener('click', e => { if (e.target === $('detail-modal')) hideModal(); });

    // 周报选择器
    $('weekly-week-select').addEventListener('change', e => renderWeeklyReport(e.target.value));

    // 审计筛选器
    const auditSearch = $('audit-search-input');
    if (auditSearch) auditSearch.addEventListener('input', e => { auditFilters.search = e.target.value; renderAuditView(); });
    const auditRole = $('audit-role-select');
    if (auditRole) auditRole.addEventListener('change', e => { auditFilters.role = e.target.value; renderAuditView(); });
    const auditIgnoreReq = $('audit-ignore-req-checkbox');
    if (auditIgnoreReq) auditIgnoreReq.addEventListener('change', e => { auditFilters.ignoreReq = e.target.checked; renderAuditView(); });

    // 工作项筛选器
    ['filter-search', 'filter-category', 'filter-status', 'filter-assignee', 'filter-priority', 'filter-iteration', 'filter-business-line'].forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener('input', () => { applyFilters(); syncStateToURL(); });
            el.addEventListener('change', () => { applyFilters(); syncStateToURL(); });
        }
    });

    // 图表状态模式切换（活跃/全部）
    $$('.chart-status-tab').forEach(tab => tab.addEventListener('click', e => {
        $$('.chart-status-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.chartStatusMode = e.currentTarget.dataset.statusMode;
        if (state.currentView === 'overview') {
            const items = state.latest[state.currentProject] || [];
            renderStatusChart(items);
            renderTypeChart(items);
            renderWorkloadChart(items);
            renderGanttChart();
        }
    }));

    // 甘特图视图模式（日/周/月）
    $$('.gantt-view-btn').forEach(btn => btn.addEventListener('click', e => {
        $$('.gantt-view-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        setGanttViewMode(e.currentTarget.dataset.view);
        renderGanttChart();
    }));

    // 甘特图导航按钮
    $('gantt-btn-today').addEventListener('click', () => { setGanttViewMode(state.ganttViewMode); renderGanttChart(); });
    $('gantt-btn-prev').addEventListener('click', () => shiftGanttTimeline(-1));
    $('gantt-btn-next').addEventListener('click', () => shiftGanttTimeline(1));

    // 甘特图类别标签
    $$('.gantt-category-tab').forEach(tab => tab.addEventListener('click', e => {
        $$('.gantt-category-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.ganttCategory = e.currentTarget.dataset.ganttCat;
        renderGanttChart();
    }));

    // 甘特图角色/业务线筛选
    const ganttRole = $('gantt-role-select');
    if (ganttRole) ganttRole.addEventListener('change', renderGanttChart);
    const ganttBiz = $('gantt-bizline-select');
    if (ganttBiz) ganttBiz.addEventListener('change', renderGanttChart);

    // QA 缓解弹窗关闭
    const btnCloseMit = $('btn-close-mitigation');
    if (btnCloseMit) btnCloseMit.addEventListener('click', hideQAMitigationModal);
    const mitModal = $('qa-mitigation-modal');
    if (mitModal) mitModal.addEventListener('click', e => { if (e.target === mitModal) hideQAMitigationModal(); });

    // 导出 Markdown 周报
    const btnExport = $('btn-export-markdown');
    if (btnExport) btnExport.addEventListener('click', exportMarkdownSnippet);

    // 数据更新横条点击：隐藏横条并切换到数据看板视图
    const updateBanner = $('update-banner');
    if (updateBanner) {
        updateBanner.addEventListener('click', () => {
            getUpdateNotifier().hideUpdateBanner();
            // 自动切换到数据看板视图查看最新数据
            const overviewTab = document.querySelector('.nav-tab[data-view="overview"]');
            if (overviewTab) overviewTab.click();
        });
    }

    // 甘特图横屏切换
    const btnLandscape = $('btn-gantt-landscape');
    if (btnLandscape) btnLandscape.addEventListener('click', () => {
        const card = document.querySelector('.gantt-chart-card');
        if (card) {
            const isLandscape = card.classList.toggle('landscape-fullscreen');
            const span = btnLandscape.querySelector('span');
            if (span) span.textContent = isLandscape ? '返回竖屏' : '横屏查看';
            window.dispatchEvent(new Event('resize'));
        }
    });
}

// 页面加载入口：登录门控
document.addEventListener('DOMContentLoaded', async () => {
    // 加载认证配置（从 auth.config.json 读取凭证）
    await loadAuthConfig();

    const overlay = $('login-overlay');
    const btnLogout = $('btn-logout');

    // 绑定登录表单提交
    const btnSubmit = $('btn-login-submit');
    if (btnSubmit) btnSubmit.addEventListener('click', handleLoginSubmit);

    // 绑定输入框回车键
    [$('login-username'), $('login-password')].forEach(field => {
        if (field) field.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoginSubmit(); });
    });

    // 绑定登出
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);

    // 会话检查：已登录则直接启动，未登录则显示登录界面
    if (checkSession()) {
        overlay.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'flex';
        await startDashboardApp();
    } else {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
        if (btnLogout) btnLogout.style.display = 'none';
    }
});
