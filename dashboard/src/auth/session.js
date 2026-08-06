/**
 * 认证会话管理模块
 * 负责加载认证配置、会话校验、登录/登出、滑动超时刷新
 */

import { showToast } from '../utils/index.js';

// 认证配置对象，由 loadAuthConfig() 动态加载
let AUTH_CONFIG = {
    username: 'jeremy',
    passwordHash: '',
    sessionExpiryHours: 4,
    absoluteExpiryHours: 24
};

/**
 * 异步加载认证配置文件
 * 优先从 auth.config.json 加载实际凭证，失败时 fallback 到 auth.config.example.json
 */
export async function loadAuthConfig() {
    try {
        const response = await fetch('./auth.config.json');
        if (response.ok) {
            const config = await response.json();
            AUTH_CONFIG = {
                username: config.username || AUTH_CONFIG.username,
                passwordHash: config.passwordHash || AUTH_CONFIG.passwordHash,
                sessionExpiryHours: config.sessionExpiryHours || 4,
                absoluteExpiryHours: config.absoluteExpiryHours || 24
            };
            return;
        }
        throw new Error('auth.config.json not found');
    } catch (err) {
        console.warn('认证配置文件加载失败，尝试加载模板文件:', err);
        try {
            const fallbackResponse = await fetch('./auth.config.example.json');
            if (fallbackResponse.ok) {
                const config = await fallbackResponse.json();
                AUTH_CONFIG = {
                    username: config.username || AUTH_CONFIG.username,
                    passwordHash: config.passwordHash || AUTH_CONFIG.passwordHash,
                    sessionExpiryHours: config.sessionExpiryHours || 4,
                    absoluteExpiryHours: config.absoluteExpiryHours || 24
                };
            }
        } catch (fallbackErr) {
            console.warn('模板配置文件也加载失败，使用默认配置:', fallbackErr);
        }
        showToast('认证配置缺失，请创建 auth.config.json 文件');
    }
}

/**
 * 检查当前会话是否有效
 * @param {boolean} refreshSliding - 是否刷新滑动超时时间戳
 * @returns {boolean} 会话是否有效
 */
export function checkSession(refreshSliding = true) {
    const token = localStorage.getItem('devops_session_token');
    const timestamp = localStorage.getItem('devops_session_timestamp');
    const loginTime = localStorage.getItem('devops_session_login_time');

    if (token === 'devops-session-active' && timestamp) {
        const now = Date.now();
        const elapsed = now - parseInt(timestamp, 10);
        const slidingExpiryMs = AUTH_CONFIG.sessionExpiryHours * 60 * 60 * 1000;

        // 1. 检查滑动超时
        if (elapsed >= slidingExpiryMs) {
            clearSession();
            return false;
        }

        // 2. 检查绝对超时
        if (loginTime) {
            const elapsedLogin = now - parseInt(loginTime, 10);
            const absoluteExpiryMs = AUTH_CONFIG.absoluteExpiryHours * 60 * 60 * 1000;
            if (elapsedLogin >= absoluteExpiryMs) {
                clearSession();
                return false;
            }
        } else {
            // 为旧 Session 兼容，补记录当前 timestamp 为登录时间
            localStorage.setItem('devops_session_login_time', timestamp);
        }

        // 验证通过，如果需要刷新滑动过期时间，则更新
        if (refreshSliding) {
            localStorage.setItem('devops_session_timestamp', now.toString());
        }
        return true;
    }

    clearSession();
    return false;
}

/**
 * 清除会话存储信息
 */
export function clearSession() {
    localStorage.removeItem('devops_session_token');
    localStorage.removeItem('devops_session_timestamp');
    localStorage.removeItem('devops_session_login_time');
}

/**
 * 处理登录表单提交
 * 使用 SHA-256 哈希校验密码，不存明文凭证
 */
export async function handleLoginSubmit() {
    const userEl = document.getElementById('login-username');
    const passEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error-msg');
    const errorTextEl = document.getElementById('login-error-text');
    const cardEl = document.querySelector('.login-card');

    const username = userEl.value.trim();
    const password = passEl.value;

    if (username.toLowerCase() !== AUTH_CONFIG.username) {
        errorTextEl.textContent = '用户名或密码不正确';
        errorEl.style.display = 'flex';
        cardEl.style.animation = 'none';
        cardEl.offsetHeight;
        cardEl.style.animation = 'shake 0.4s ease';
        passEl.value = '';
        passEl.focus();
        return;
    }

    // 使用 SHA-256 哈希校验密码
    try {
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('Crypto API unavailable');
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex !== AUTH_CONFIG.passwordHash) {
            throw new Error('Invalid password');
        }
    } catch (e) {
        if (e.message === 'Crypto API unavailable') {
            errorTextEl.textContent = '当前环境不支持安全登录，请使用 HTTPS 访问';
        } else {
            errorTextEl.textContent = '用户名或密码不正确';
        }
        errorEl.style.display = 'flex';
        cardEl.style.animation = 'none';
        cardEl.offsetHeight;
        cardEl.style.animation = 'shake 0.4s ease';
        passEl.value = '';
        passEl.focus();
        return;
    }

    // 登录成功，写入会话信息
    const nowStr = Date.now().toString();
    localStorage.setItem('devops_session_token', 'devops-session-active');
    localStorage.setItem('devops_session_timestamp', nowStr);
    localStorage.setItem('devops_session_login_time', nowStr);

    // 淡出登录遮罩
    const overlay = document.getElementById('login-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.display = 'none';
        document.getElementById('btn-logout').style.display = 'flex';
    }, 300);

    // 启动看板应用（动态导入避免循环依赖）
    const { startDashboardApp } = await import('../app.js');
    startDashboardApp();
}

/**
 * 处理退出登录
 */
export function handleLogout() {
    clearSession();
    const overlay = document.getElementById('login-overlay');
    document.getElementById('btn-logout').style.display = 'none';

    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error-msg').style.display = 'none';

    overlay.style.display = 'flex';
    overlay.style.opacity = '1';

    // 重新加载页面以清除内存中的所有数据
    window.location.reload();
}

/**
 * 初始化用户活跃事件监听器
 * 监听鼠标、键盘、滚动、触摸事件以刷新滑动超时
 */
export function initSessionActivityListener() {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    let lastRefresh = Date.now();

    const handler = () => {
        const now = Date.now();
        // 节流处理，限制 1 分钟最多刷新一次 localStorage 写入以优化性能
        if (now - lastRefresh > 60000) {
            const token = localStorage.getItem('devops_session_token');
            if (token === 'devops-session-active') {
                localStorage.setItem('devops_session_timestamp', now.toString());
            }
            lastRefresh = now;
        }
    };

    events.forEach(evt => {
        window.addEventListener(evt, handler, { passive: true });
    });
}
