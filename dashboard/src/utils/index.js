/**
 * 工具函数集合模块
 * 提供各模块共用的通用工具函数
 */

import { state } from '../state/index.js';
import { DEFAULT_BUSINESS_LINE_CONFIG, DEVELOPER_ROLES_MAP } from '../config/constants.js';

/**
 * 判断工作项是否已完成/已交付
 * @param {Object} item - 工作项对象
 * @returns {boolean}
 */
export function isItemCompleted(item) {
    const status = item.status || '';
    const cat = item.category || 'Req';
    const workItemType = item.workItemType || '';

    // 所有类型通用的终态状态
    const baseCompleted = [
        '已上线', '已关闭', '测试环境验证通过', '测试环境验收通过',
        '预发布验收通过', '生产验收通过', '产品验收通过', '已完成',
        '已关闭（已修复）', '已关闭（未修复）'
    ];

    if (baseCompleted.includes(status)) {
        return true;
    }

    // 开发任务提交测试后视为已交付（测试类型任务除外）
    if (cat === 'Task') {
        const testingStatuses = ['提交测试', '测试中', '待测试', '发包已测试', '已提测'];
        if (testingStatuses.includes(status)) {
            if (workItemType === '測試') {
                return false;
            }
            return true;
        }
    }

    // 缺陷暂不修复视为已关闭
    if (cat === 'Bug') {
        const inactiveBugStatuses = ['暂不修复'];
        if (inactiveBugStatuses.includes(status)) {
            return true;
        }
    }

    return false;
}

// ── 业务线分类 ──

/**
 * 从 localStorage 加载业务线关键词配置
 * @returns {Object} 业务线配置对象
 */
export function loadBusinessLineConfig() {
    try {
        const saved = localStorage.getItem('devops_config_businessLine');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.daojia && parsed.daodian && parsed.zhongbao) return parsed;
        }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_BUSINESS_LINE_CONFIG));
}

/**
 * 保存业务线关键词配置到 localStorage
 * @param {Object} config - 业务线配置对象
 */
export function saveBusinessLineConfig(config) {
    localStorage.setItem('devops_config_businessLine', JSON.stringify(config));
}

/**
 * 根据工作项标题和原始行文本判断业务线归属
 * @param {Object} item - 工作项对象
 * @returns {string} 'zhongbao' | 'daojia' | 'daodian' | 'other'
 */
export function getBusinessLine(item) {
    const config = loadBusinessLineConfig();
    const title = ((item.title || '') + ' ' + (item.rowText || '')).toLowerCase();
    for (const kw of config.zhongbao) { if (title.includes(kw.toLowerCase())) return 'zhongbao'; }
    for (const kw of config.daojia) { if (title.includes(kw.toLowerCase())) return 'daojia'; }
    for (const kw of config.daodian) { if (title.includes(kw.toLowerCase())) return 'daodian'; }
    return 'other';
}

/**
 * 判断工作项是否属于关键路径
 * @param {Object} item - 工作项对象
 * @returns {boolean}
 */
export function isCriticalPath(item) {
    if (!state.criticalPathConfig) {
        state.criticalPathConfig = {
            keywords: ["订单", "支付", "收银台", "消费金"],
            ids: []
        };
    }
    const { keywords, ids } = state.criticalPathConfig;
    if (ids && ids.includes(item.id)) {
        return true;
    }
    if (keywords && item.title) {
        return keywords.some(kw => item.title.includes(kw));
    }
    return false;
}

/**
 * 推断开发人员角色
 * 优先查表，查不到则根据工作项标题关键词评分推断
 * @param {string} devName - 开发人员姓名
 * @param {Array} allItems - 全部工作项列表
 * @returns {string} 角色标识
 */
export function inferDeveloperRole(devName, allItems) {
    if (!devName) return 'Fullstack';

    if (DEVELOPER_ROLES_MAP[devName]) {
        return DEVELOPER_ROLES_MAP[devName];
    }

    const devItems = allItems.filter(x => x.assignee === devName || x.creator === devName);
    if (devItems.length === 0) return 'Fullstack';

    let score = { Mobile: 0, Frontend: 0, Backend: 0, UI: 0, Ops: 0, Product: 0, PM: 0, Tester: 0 };

    const keywords = {
        Mobile: /android|ios|app|flutter|uniapp|移动|原生|客户端/i,
        Frontend: /vue|react|h5|小程序|页面|前端|css|组件|网页/i,
        Backend: /sql|mysql|db|数据库|接口|api|后台|服务端|微服务|架构|redis|后端|服务|表结构/i,
        UI: /ui|设计|切图|样机|交互/i,
        Ops: /运维|上线|发布|部署|服务器|环境/i,
        Product: /需求|产品|prd|原型|脑图|功能点/i,
        PM: /项目管理|排期|汇报|进度|双周|周报|会议/i,
        Tester: /用例|测试报告|测试用例|性能测试|安全测试/i
    };

    devItems.forEach(item => {
        const text = ((item.title || '') + ' ' + (item.rowText || '') + ' ' + (item.category || '')).toLowerCase();
        if (keywords.Mobile.test(text)) score.Mobile++;
        if (keywords.Frontend.test(text)) score.Frontend++;
        if (keywords.Backend.test(text)) score.Backend++;
        if (keywords.UI.test(text)) score.UI++;
        if (keywords.Ops.test(text)) score.Ops++;
        if (keywords.Product.test(text)) score.Product++;
        if (keywords.PM.test(text)) score.PM++;
        if (keywords.Tester.test(text)) score.Tester++;
    });

    let maxVal = 0;
    let maxRole = 'Fullstack';
    let isTie = false;

    Object.entries(score).forEach(([role, val]) => {
        if (val > maxVal) {
            maxVal = val;
            maxRole = role;
            isTie = false;
        } else if (val === maxVal && val > 0) {
            isTie = true;
        }
    });

    if (isTie || maxVal === 0) {
        return 'Fullstack';
    }
    return maxRole;
}

// ── 日期格式化与比较工具 ──

/**
 * 格式化日期为 YYYY-MM-DD HH:mm:ss
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 判断两个日期是否同一天
 */
export function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

/**
 * 获取 ISO 周数
 */
export function getWeekNumber(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/**
 * 判断日期是否在当前周
 */
export function isCurrentWeek(d, today) {
    const w1 = getWeekNumber(d);
    const w2 = getWeekNumber(today);
    return d.getFullYear() === today.getFullYear() && w1 === w2;
}

/**
 * 判断日期是否在当前月
 */
export function isCurrentMonth(d, today) {
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
}

// ── HTML 与 UI 工具 ──

/**
 * HTML 转义，防止 XSS
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

/**
 * 根据状态返回对应的徽章 CSS 类名
 * @param {string} status
 * @returns {string}
 */
export function getStatusBadgeClass(status) {
    const completedList = ['已上线', '已关闭', '生产验收通过', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'];
    const testingList = ['测试中', '待测试', '提交测试', '发包已测试', '已提测'];
    const progressList = ['开发中', '待开发', '待处理', '方案设计中', '产品方案已确认', '处理中', '设计中', '需产品梳理/确认'];

    if (completedList.includes(status)) return 'badge-status-completed';
    if (testingList.includes(status)) return 'badge-status-testing';
    if (progressList.includes(status)) return 'badge-status-progress';
    if (status === '开发挂起' || status === '挂起' || status === '暂不修复') return 'badge-status-blocked';
    return 'badge-status-pending';
}

/**
 * 显示 Toast 提示消息
 * @param {string} message - 提示文本
 */
export function showToast(message) {
    const toast = document.getElementById('toast-alert');
    const msg = document.getElementById('toast-message');
    msg.textContent = message;

    toast.style.display = 'block';
    // 触发 CSS 重排
    toast.offsetHeight;
    toast.classList.add('active');

    // 3.5 秒后自动隐藏
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
        setTimeout(() => {
            toast.style.display = 'none';
        }, 300);
    }, 3500);
}
