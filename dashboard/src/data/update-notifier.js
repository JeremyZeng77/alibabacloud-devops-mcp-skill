/**
 * 数据变更通知模块
 * 管理数据更新后的用户通知：Toast 提示 + Tab 红点徽标 + 顶部横条
 * 支持节流（30 秒内合并通知）和开关控制
 */

import { showToast } from '../utils/index.js';

/** 节流间隔（毫秒），连续多次更新在此间隔内只通知一次 */
const THROTTLE_MS = 30000;
/** 通知开关的 localStorage key */
const CONFIG_KEY = 'devops_config_updateNotify';
/** 所有视图名称列表 */
const VIEW_NAMES = ['overview', 'workitems', 'weekly', 'audit', 'risk', 'config'];

/**
 * 数据变更通知管理类
 */
export class UpdateNotifier {
    constructor() {
        /** 已通知但未查看的视图集合 */
        this.notifiedViews = new Set();
        /** 通知开关（从 localStorage 读取） */
        this.enabled = this._readEnabled();
        /** 上次通知时间戳（节流用） */
        this.lastNotifyTime = 0;
        /** 当前节流窗口内的通知次数 */
        this.notifyCount = 0;
    }

    /**
     * 从 localStorage 读取通知开关状态
     * @returns {boolean} 是否启用通知
     * @private
     */
    _readEnabled() {
        try {
            return localStorage.getItem(CONFIG_KEY) !== 'false';
        } catch {
            return true;
        }
    }

    /**
     * 获取当前激活的视图名称
     * @returns {string} 当前视图名称
     * @private
     */
    _getCurrentView() {
        const activeTab = document.querySelector('.nav-tab.active');
        return activeTab ? activeTab.dataset.view : 'overview';
    }

    /**
     * 检查通知是否启用
     * @returns {boolean} 是否启用
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * 设置通知开关
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        try {
            localStorage.setItem(CONFIG_KEY, String(enabled));
        } catch { /* 忽略存储异常 */ }

        if (!enabled) {
            this.hideUpdateBanner();
            this._clearAllBadges();
        }
    }

    /**
     * 触发更新通知
     * 节流：30 秒内连续多次更新只通知一次，合并为"数据已更新（N 次）"
     * @param {string} compiledAt - 数据编译时间戳
     */
    notifyUpdate(compiledAt) {
        if (!this.enabled) return;

        const now = Date.now();
        const timeSinceLastNotify = now - this.lastNotifyTime;

        if (timeSinceLastNotify < THROTTLE_MS) {
            // 节流窗口内：只增加计数，更新横条文字，不再弹 Toast
            this.notifyCount++;
            this._updateBannerText();
            return;
        }

        // 新的通知窗口
        this.lastNotifyTime = now;
        this.notifyCount = 1;

        // 显示 Toast 提示
        showToast('数据已更新，点击查看最新内容。');

        // 为所有非当前视图的 Tab 添加红点徽标
        const currentView = this._getCurrentView();
        VIEW_NAMES.forEach(view => {
            if (view !== currentView) {
                this.notifiedViews.add(view);
                this._showBadge(view);
            }
        });

        // 显示顶部"查看更新"横条
        this.showUpdateBanner();
    }

    /**
     * 显示指定视图 Tab 的红点徽标
     * @param {string} viewName - 视图名称
     * @private
     */
    _showBadge(viewName) {
        const tab = document.querySelector(`.nav-tab[data-view="${viewName}"]`);
        if (tab) {
            const badge = tab.querySelector('.tab-update-badge');
            if (badge) {
                badge.style.display = 'inline-block';
            }
        }
    }

    /**
     * 隐藏指定视图 Tab 的红点徽标
     * @param {string} viewName - 视图名称
     * @private
     */
    _hideBadge(viewName) {
        const tab = document.querySelector(`.nav-tab[data-view="${viewName}"]`);
        if (tab) {
            const badge = tab.querySelector('.tab-update-badge');
            if (badge) {
                badge.style.display = 'none';
            }
        }
    }

    /**
     * 清除所有 Tab 的红点徽标
     * @private
     */
    _clearAllBadges() {
        VIEW_NAMES.forEach(view => this._hideBadge(view));
        this.notifiedViews.clear();
    }

    /**
     * 更新横条文字（含通知次数）
     * @private
     */
    _updateBannerText() {
        const banner = document.getElementById('update-banner');
        if (banner) {
            const textEl = banner.querySelector('.update-banner-text');
            if (textEl) {
                textEl.textContent = this.notifyCount > 1
                    ? `数据已更新（${this.notifyCount} 次）`
                    : '数据已更新';
            }
        }
    }

    /**
     * 标记某视图已查看（移除该 Tab 的红点）
     * 如果所有视图都已查看，隐藏横条
     * @param {string} viewName - 视图名称
     */
    markViewSeen(viewName) {
        this.notifiedViews.delete(viewName);
        this._hideBadge(viewName);

        // 所有视图都已查看时隐藏横条
        if (this.notifiedViews.size === 0) {
            this.hideUpdateBanner();
        }
    }

    /**
     * 显示顶部"查看更新"横条
     */
    showUpdateBanner() {
        const banner = document.getElementById('update-banner');
        if (banner) {
            this._updateBannerText();
            banner.style.display = 'flex';
        }
    }

    /**
     * 隐藏顶部"查看更新"横条
     */
    hideUpdateBanner() {
        const banner = document.getElementById('update-banner');
        if (banner) {
            banner.style.display = 'none';
        }
    }
}

/** 懒加载单例实例 */
let _instance = null;

/**
 * 获取 UpdateNotifier 单例
 * @returns {UpdateNotifier} 单例实例
 */
export function getUpdateNotifier() {
    if (!_instance) {
        _instance = new UpdateNotifier();
    }
    return _instance;
}
