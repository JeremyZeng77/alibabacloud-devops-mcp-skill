/**
 * 配置存储管理模块
 * 封装 localStorage 的读写操作，统一 devops_config_ 前缀
 */

/**
 * 从 localStorage 加载配置
 * @param {string} key - 配置键名（不含前缀）
 * @param {*} defaultVal - 默认值
 * @returns {*} 解析后的配置值或默认值
 */
export function loadConfig(key, defaultVal) {
    try {
        return JSON.parse(localStorage.getItem('devops_config_' + key) || 'null') || defaultVal;
    } catch {
        return defaultVal;
    }
}

/**
 * 保存配置到 localStorage
 * @param {string} key - 配置键名（不含前缀）
 * @param {*} val - 配置值
 */
export function saveConfig(key, val) {
    localStorage.setItem('devops_config_' + key, JSON.stringify(val));
}
