/**
 * 数据加载模块
 * 负责从本地 JSON 加载看板数据、轮询检测更新、触发同步编译、加载关键路径配置等
 */

import { state, loadStateFromURL } from '../state/index.js';
import { showToast, formatDate, isItemCompleted } from '../utils/index.js';
import { BRIDGE_API_BASE, DEVELOPER_ROLES_MAP } from '../config/constants.js';
import { checkSession, handleLogout } from '../auth/session.js';
import { getUpdateNotifier } from './update-notifier.js';

// 动态导入视图渲染函数（避免循环依赖）
let _renderCurrentView = null;
async function getRenderCurrentView() {
    if (!_renderCurrentView) {
        const mod = await import('../views/workitems.js');
        _renderCurrentView = mod.renderCurrentView;
    }
    return _renderCurrentView;
}

let _populateWeeklySelector = null;
async function getPopulateWeeklySelector() {
    if (!_populateWeeklySelector) {
        const mod = await import('../views/weekly.js');
        _populateWeeklySelector = mod.populateWeeklySelector;
    }
    return _populateWeeklySelector;
}

/**
 * 加载关键路径配置文件
 */
export async function loadCriticalPathConfig() {
    try {
        const response = await fetch('./critical_path_config.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Config file not found');
        const config = await response.json();
        state.criticalPathConfig = {
            keywords: Array.isArray(config.keywords) ? config.keywords : ["订单", "支付", "收银台", "消费金"],
            ids: Array.isArray(config.ids) ? config.ids : []
        };
    } catch (err) {
        console.warn('Failed to load critical path config, using defaults:', err);
        state.criticalPathConfig = {
            keywords: ["订单", "支付", "收银台", "消费金"],
            ids: []
        };
    }
}

/**
 * 动态统计各角色下的人员数量，并更新下拉框选项文本
 */
export function updateRoleSelectsWithCounts() {
    const roleCounts = {
        Backend: 0, Frontend: 0, Mobile: 0, UI: 0, Ops: 0, Product: 0, PM: 0, Tester: 0
    };

    Object.values(DEVELOPER_ROLES_MAP).forEach(role => {
        if (roleCounts[role] !== undefined) {
            roleCounts[role]++;
        }
    });

    const totalCount = Object.values(roleCounts).reduce((sum, val) => sum + val, 0);

    const ganttLabels = {
        all: `全角色 (${totalCount}人)`,
        Backend: `服务端 (${roleCounts.Backend}人)`,
        Frontend: `前端开发 (${roleCounts.Frontend}人)`,
        Mobile: `移动开发 (${roleCounts.Mobile}人)`,
        Tester: `测试 (${roleCounts.Tester}人)`,
        Product: `产品 (${roleCounts.Product}人)`,
        UI: `UI设计 (${roleCounts.UI}人)`,
        PM: `项目经理 (${roleCounts.PM}人)`,
        Ops: `运维 (${roleCounts.Ops}人)`
    };

    const auditLabels = {
        all: `全部角色 (${totalCount}人)`,
        Backend: `服务端 (${roleCounts.Backend}人)`,
        Frontend: `前端 (${roleCounts.Frontend}人)`,
        Mobile: `移动端 (${roleCounts.Mobile}人)`,
        Tester: `测试 (${roleCounts.Tester}人)`,
        Product: `产品 (${roleCounts.Product}人)`,
        UI: `UI设计 (${roleCounts.UI}人)`,
        PM: `项目经理 (${roleCounts.PM}人)`,
        Ops: `运维 (${roleCounts.Ops}人)`
    };

    const selectGantt = document.getElementById('gantt-role-select');
    if (selectGantt) {
        Array.from(selectGantt.options).forEach(opt => {
            if (ganttLabels[opt.value]) opt.textContent = ganttLabels[opt.value];
        });
    }

    const selectAudit = document.getElementById('audit-role-select');
    if (selectAudit) {
        Array.from(selectAudit.options).forEach(opt => {
            if (auditLabels[opt.value]) opt.textContent = auditLabels[opt.value];
        });
    }
}

/**
 * 加载看板数据（主入口）
 * 依次加载关键路径配置、URL 状态、角色统计、JSON 数据，最后渲染视图
 */
export async function loadDashboardData() {
    try {
        await loadCriticalPathConfig();
        loadStateFromURL();
        updateRoleSelectsWithCounts();

        const response = await fetch('./data/projects_data.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Data file not found');
        const db = await response.json();

        // 更新全局状态
        state.compiledAt = db.compiledAt;
        state.latest = db.latest;
        state.history = db.history;
        state.weeklyReports = db.weeklyReports || [];
        state.leadTimeKPI = db.leadTimeKPI || { mftb: { average: 0, delta: 0 }, mfood: { average: 0, delta: 0 } };
        state.pmoAdvice = db.pmoAdvice || {};

        updateTimestamps();

        // 填充周报选择器并渲染当前视图
        const populateWeeklySelector = await getPopulateWeeklySelector();
        populateWeeklySelector();

        const renderCurrentView = await getRenderCurrentView();
        renderCurrentView();

    } catch (err) {
        console.error('Failed to load dashboard data:', err);
        showToast('无法加载本地 JSON 数据库，请确保已运行编译脚本。');
    }
}

/**
 * 后台静默轮询数据（每 60 秒）
 * 检测 compiledAt 变化时自动刷新视图
 */
export async function pollDashboardData() {
    // 后台静默轮询时进行只读检测，如超时则强制登出
    if (!checkSession(false)) {
        handleLogout();
        return;
    }

    try {
        const response = await fetch('./data/projects_data.json?t=' + new Date().getTime());
        if (!response.ok) return;
        const db = await response.json();

        if (state.compiledAt !== db.compiledAt) {
            console.log('Detect database updates, auto-refreshing...');
            state.compiledAt = db.compiledAt;
            state.latest = db.latest;
            state.history = db.history;
            state.weeklyReports = db.weeklyReports || [];
            state.leadTimeKPI = db.leadTimeKPI || { mftb: { average: 0, delta: 0 }, mfood: { average: 0, delta: 0 } };
            state.pmoAdvice = db.pmoAdvice || {};

            updateTimestamps();
            const renderCurrentView = await getRenderCurrentView();
            renderCurrentView();
            // 通过 UpdateNotifier 通知用户数据已更新（替代直接 showToast）
            getUpdateNotifier().notifyUpdate(db.compiledAt);
        }
    } catch (err) {
        // 后台轮询静默失败
    }
}

/**
 * 触发同步编译（手动触发）
 * 线上环境通过 GitHub Actions API 或 Vercel 中转触发，本地环境调用 bridge_server
 */
export async function triggerSyncCompile() {
    const btn = document.getElementById('btn-sync-compile');
    btn.classList.add('spinning');

    const isLocal = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname.startsWith('192.168.');

    if (!isLocal) {
        let vercelUrl = localStorage.getItem('vercel_sync_url') || 'https://alibabacloud-devops-mcp-skill.vercel.app/api/sync';
        let pat = localStorage.getItem('github_pat') || '';

        // 1. 尝试通过 Vercel 免密服务触发
        if (!pat && vercelUrl) {
            showToast('正在通过云端免密服务触发同步...');
            try {
                const response = await fetch(vercelUrl, { method: 'POST' });
                const data = await response.json();
                if (response.ok && data.ok) {
                    showToast('已成功通过云端免密服务触发同步构建！更新大约需要 15 秒，请稍后刷新。');
                    btn.classList.remove('spinning');
                    return;
                } else {
                    console.warn('Vercel sync proxy failed:', data.error);
                }
            } catch (err) {
                console.warn('Vercel sync proxy network error, falling back to PAT prompt.');
            }
        }

        // 2. Fallback 到 PAT/URL 输入
        if (!pat) {
            const input = prompt('请输入您的 GitHub 个人访问令牌 (PAT) 以便在线上直接触发同步编译（若已配置 Vercel 免费中转服务，请直接粘贴您的 Vercel URL 接口以开启免密同步）：');
            if (!input) {
                btn.classList.remove('spinning');
                showToast('已取消同步。');
                return;
            }

            const trimmed = input.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                localStorage.setItem('vercel_sync_url', trimmed);
                btn.classList.remove('spinning');
                triggerSyncCompile();
                return;
            } else {
                pat = trimmed;
                localStorage.setItem('github_pat', pat);
            }
        }

        // 3. 通过 PAT 直接调用 GitHub Actions API
        showToast('正在向 GitHub API 发送构建指令...');
        try {
            const url = 'https://api.github.com/repos/JeremyZeng77/alibabacloud-devops-mcp-skill/actions/workflows/sync-data.yml/dispatches';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${pat}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ref: 'main' })
            });

            if (response.status === 204) {
                showToast('已成功在云端触发同步构建！更新大约需要 15 秒，请稍后刷新。');
                btn.classList.remove('spinning');
            } else {
                const errText = await response.text();
                console.error('Trigger cloud sync failed:', response.status, errText);
                if (response.status === 401 || response.status === 403) {
                    showToast('令牌无效或权限不足，已清除保存的令牌，请重试！');
                    localStorage.removeItem('github_pat');
                } else {
                    showToast(`触发云端同步失败 (${response.status})，请检查设置。`);
                }
                btn.classList.remove('spinning');
            }
        } catch (err) {
            console.error('Cloud sync failed:', err);
            showToast('无法连接到 GitHub API，请检查您的网络连接！');
            btn.classList.remove('spinning');
        }
        return;
    }

    // 本地编译流程
    showToast('正在向本地桥接服务发送编译指令...');
    try {
        const response = await fetch(`${BRIDGE_API_BASE}/compile`, { method: 'GET' });
        const res = await response.json();

        if (response.ok && res.ok) {
            showToast('编译成功！正在加载最新看板数据...');
            setTimeout(() => {
                loadDashboardData();
                btn.classList.remove('spinning');
            }, 500);
        } else {
            throw new Error(res.error || 'Server compile error');
        }
    } catch (err) {
        console.error('Compile failed:', err);
        showToast('编译触发失败。请确保本地 bridge_server.py 正在运行！');
        btn.classList.remove('spinning');
    }
}

/**
 * 更新页面上的时间戳显示
 */
export function updateTimestamps() {
    if (state.compiledAt) {
        const date = new Date(state.compiledAt);
        document.getElementById('time-compiled').textContent = formatDate(date);
    } else {
        document.getElementById('time-compiled').textContent = 'N/A';
    }

    if (state.compiledAt) {
        const date = new Date(state.compiledAt);
        const pad = (n) => n.toString().padStart(2, '0');
        document.getElementById('time-collected').textContent = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    } else {
        document.getElementById('time-collected').textContent = 'N/A';
    }
}
