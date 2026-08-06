/**
 * 配置导入导出模块
 * 扫描 localStorage 中所有 devops_config_* key，支持序列化导出和导入校验
 */

import { showToast } from '../utils/index.js';

/** localStorage 中配置项的前缀 */
const CONFIG_PREFIX = 'devops_config_';
/** 已知的配置 key 列表（用于校验导入文件） */
const KNOWN_CONFIG_KEYS = ['roles', 'milestones', 'criticalKeywords', 'businessLine', 'updateNotify'];

/**
 * 导出配置为 JSON 文件
 * 扫描 localStorage 中所有 devops_config_* key，序列化为 JSON 对象，生成 Blob 下载
 */
export function exportConfig() {
    const config = {};

    // 扫描所有 devops_config_* key
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(CONFIG_PREFIX)) {
            const configKey = key.slice(CONFIG_PREFIX.length);
            try {
                config[configKey] = JSON.parse(localStorage.getItem(key));
            } catch {
                // 非 JSON 值，直接存储原始字符串
                config[configKey] = localStorage.getItem(key);
            }
        }
    });

    // 生成文件名：devops-config-YYYYMMDD.json
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const filename = `devops-config-${dateStr}.json`;

    // 创建 Blob 并触发下载
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('配置已导出为 ' + filename);
}

/**
 * 导入配置文件
 * 读取上传的 JSON 文件，解析校验格式
 * @param {File} file - 用户上传的 JSON 文件
 * @returns {Promise<Object|null>} 解析后的配置对象，校验失败返回 null
 */
export async function importConfig(file) {
    const text = await file.text();
    let data;

    try {
        data = JSON.parse(text);
    } catch {
        showToast('配置文件格式不正确：JSON 解析失败');
        return null;
    }

    const validation = validateConfigFile(data);
    if (!validation.valid) {
        showToast(`配置文件校验失败：${validation.message}`);
        return null;
    }

    return data;
}

/**
 * 校验配置文件格式
 * 检查 JSON 结构是否包含已知配置 key
 * @param {Object} data - 解析后的配置对象
 * @returns {{valid: boolean, message: string}} 校验结果
 */
export function validateConfigFile(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, message: '配置文件根节点必须是 JSON 对象' };
    }

    const keys = Object.keys(data);
    if (keys.length === 0) {
        return { valid: false, message: '配置文件不包含任何配置项' };
    }

    const knownKeys = keys.filter(k => KNOWN_CONFIG_KEYS.includes(k));
    if (knownKeys.length === 0) {
        return {
            valid: false,
            message: `配置文件不包含已知配置项（期望: ${KNOWN_CONFIG_KEYS.join(', ')}）`
        };
    }

    return { valid: true, message: `包含 ${knownKeys.length} 个已知配置项` };
}

/**
 * 处理配置冲突
 * 弹窗让用户选择"覆盖/合并/跳过"，预选项为"合并"
 * @param {string[]} existingKeys - 已存在的配置 key 列表
 * @param {string[]} importedKeys - 导入的配置 key 列表
 * @returns {Promise<string>} 用户选择的策略: 'overwrite' | 'merge' | 'skip'
 */
export function handleConfigConflict(existingKeys, importedKeys) {
    return new Promise(resolve => {
        const modal = document.getElementById('config-conflict-modal');
        if (!modal) {
            // DOM 中没有冲突弹窗，默认选择合并
            resolve('merge');
            return;
        }

        // 显示冲突详情
        const conflictKeys = importedKeys.filter(k => existingKeys.includes(k));
        const detailEl = modal.querySelector('.conflict-detail');
        if (detailEl) {
            detailEl.textContent = `检测到 ${conflictKeys.length} 个配置项已存在（${conflictKeys.join(', ')}），请选择处理方式：`;
        }

        // 显示弹窗
        modal.style.display = 'flex';

        // 绑定按钮事件
        const btnOverwrite = modal.querySelector('#btn-conflict-overwrite');
        const btnMerge = modal.querySelector('#btn-conflict-merge');
        const btnSkip = modal.querySelector('#btn-conflict-skip');
        const btnClose = modal.querySelector('#btn-conflict-close');

        const cleanup = () => {
            modal.style.display = 'none';
            if (btnOverwrite) btnOverwrite.onclick = null;
            if (btnMerge) btnMerge.onclick = null;
            if (btnSkip) btnSkip.onclick = null;
            if (btnClose) btnClose.onclick = null;
        };

        if (btnOverwrite) btnOverwrite.onclick = () => { cleanup(); resolve('overwrite'); };
        if (btnMerge) btnMerge.onclick = () => { cleanup(); resolve('merge'); };
        if (btnSkip) btnSkip.onclick = () => { cleanup(); resolve('skip'); };
        if (btnClose) btnClose.onclick = () => { cleanup(); resolve('skip'); };
    });
}

/**
 * 应用导入的配置到 localStorage
 * @param {Object} data - 配置对象
 * @param {string} strategy - 处理策略: 'overwrite' | 'merge' | 'skip'
 */
export function applyImportedConfig(data, strategy) {
    if (strategy === 'skip') {
        showToast('已跳过配置导入');
        return;
    }

    // 获取已存在的配置 key
    const existingKeys = Object.keys(localStorage)
        .filter(k => k.startsWith(CONFIG_PREFIX))
        .map(k => k.slice(CONFIG_PREFIX.length));

    // 覆盖模式：先清除已有配置
    if (strategy === 'overwrite') {
        existingKeys.forEach(k => localStorage.removeItem(CONFIG_PREFIX + k));
    }

    // 覆盖和合并模式：写入导入的配置
    const importedKeys = Object.keys(data);
    importedKeys.forEach(key => {
        const value = data[key];
        const storageKey = CONFIG_PREFIX + key;
        if (typeof value === 'string') {
            localStorage.setItem(storageKey, value);
        } else {
            localStorage.setItem(storageKey, JSON.stringify(value));
        }
    });

    const actionText = strategy === 'overwrite' ? '覆盖' : '合并';
    showToast(`配置已${actionText}导入（${importedKeys.length} 项），即将刷新视图...`);
}
