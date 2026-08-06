/**
 * 自动同步管理模块
 * 管理定时自动编译触发、定时器启停
 */

import { state } from '../state/index.js';
import { showToast } from '../utils/index.js';
import { BRIDGE_API_BASE } from '../config/constants.js';

// 动态导入 loader（避免循环依赖）
let _loadDashboardData = null;
async function getLoadDashboardData() {
    if (!_loadDashboardData) {
        const mod = await import('./loader.js');
        _loadDashboardData = mod.loadDashboardData;
    }
    return _loadDashboardData;
}

/**
 * 初始化自动同步开关
 * 从 localStorage 读取上次状态，绑定 checkbox 变更事件
 */
export function initAutoSync() {
    const chk = document.getElementById('chk-auto-sync');
    if (!chk) return;

    // 从 localStorage 恢复上次状态
    const savedState = localStorage.getItem('autoSyncEnabled');
    const isEnabled = savedState === 'true';
    chk.checked = isEnabled;

    if (isEnabled) {
        startAutoSyncTimer();
    }

    chk.addEventListener('change', (e) => {
        const checked = e.target.checked;
        localStorage.setItem('autoSyncEnabled', checked);
        if (checked) {
            startAutoSyncTimer();
            showToast('已开启 5 分钟定时自动更新');
            triggerSyncCompileSilent();
        } else {
            stopAutoSyncTimer();
            showToast('已关闭定时自动更新');
        }
    });
}

/**
 * 启动自动同步定时器（每 5 分钟）
 */
export function startAutoSyncTimer() {
    stopAutoSyncTimer();
    state.autoSyncIntervalId = setInterval(() => {
        triggerSyncCompileSilent();
    }, 300000);
}

/**
 * 停止自动同步定时器
 */
export function stopAutoSyncTimer() {
    if (state.autoSyncIntervalId) {
        clearInterval(state.autoSyncIntervalId);
        state.autoSyncIntervalId = null;
    }
}

/**
 * 静默触发同步编译（后台自动调用）
 * 调用 bridge_server 的 /compile 端点，成功后重新加载数据
 */
export async function triggerSyncCompileSilent() {
    console.log('Background auto compile triggered...');
    try {
        const response = await fetch(`${BRIDGE_API_BASE}/compile`, { method: 'GET' });
        const res = await response.json();
        if (response.ok && res.ok) {
            console.log('Background compile succeeded, reloading data...');
            const loadDashboardData = await getLoadDashboardData();
            loadDashboardData();
        }
    } catch (err) {
        console.warn('Background auto-sync failed:', err);
    }
}
