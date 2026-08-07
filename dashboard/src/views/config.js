/**
 * 配置管理中心视图模块
 * 管理角色映射、里程碑、关键路径关键字、业务线关键词等本地配置
 */

import { loadConfig, saveConfig } from '../config/storage.js';
import { loadBusinessLineConfig, saveBusinessLineConfig, showToast } from '../utils/index.js';
import { exportConfig, importConfig, handleConfigConflict, applyImportedConfig } from '../config/io.js';

/**
 * 渲染配置管理中心
 * 从 localStorage 读取各配置项并填充到文本域，绑定保存、重置、导入、导出按钮事件
 */
export function renderConfigCenter() {
    const roles = loadConfig('roles', {});
    const milestones = loadConfig('milestones', {});
    const criticalKeywords = loadConfig('criticalKeywords', []);
    const bizLineConfig = loadBusinessLineConfig();

    document.getElementById('config-roles').value = JSON.stringify(roles, null, 2);
    document.getElementById('config-milestones').value = JSON.stringify(milestones, null, 2);
    document.getElementById('config-critical').value = JSON.stringify(criticalKeywords, null, 2);
    document.getElementById('config-bizline-zhongbao').value = JSON.stringify(bizLineConfig.zhongbao, null, 2);
    document.getElementById('config-bizline-daojia').value = JSON.stringify(bizLineConfig.daojia, null, 2);
    document.getElementById('config-bizline-daodian').value = JSON.stringify(bizLineConfig.daodian, null, 2);
    document.getElementById('config-bizline-other').value = JSON.stringify(bizLineConfig.other || [], null, 2);

    // 配置导出按钮
    const btnExport = document.getElementById('btn-config-export');
    if (btnExport) btnExport.onclick = exportConfig;

    // 配置导入按钮（触发隐藏的 file input）
    const btnImport = document.getElementById('btn-config-import');
    if (btnImport) btnImport.onclick = () => {
        const fileInput = document.getElementById('config-import-file');
        if (fileInput) fileInput.click();
    };

    // 配置导入文件选择处理
    const fileInput = document.getElementById('config-import-file');
    if (fileInput) fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const data = await importConfig(file);
        if (!data) { e.target.value = ''; return; }

        // 检测冲突并让用户选择处理策略
        const existingKeys = Object.keys(localStorage)
            .filter(k => k.startsWith('devops_config_'))
            .map(k => k.slice('devops_config_'.length));
        const importedKeys = Object.keys(data);
        const strategy = await handleConfigConflict(existingKeys, importedKeys);

        applyImportedConfig(data, strategy);

        // 刷新配置视图
        setTimeout(() => renderConfigCenter(), 500);
        e.target.value = '';
    };

    // 保存角色映射
    document.getElementById('btn-config-roles-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-roles').value); saveConfig('roles', v); showToast('角色映射已保存'); } catch { showToast('JSON格式错误'); }
    };
    // 保存里程碑
    document.getElementById('btn-config-milestones-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-milestones').value); saveConfig('milestones', v); showToast('里程碑已保存'); } catch { showToast('JSON格式错误'); }
    };
    // 保存关键路径关键字
    document.getElementById('btn-config-critical-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-critical').value); saveConfig('criticalKeywords', v); showToast('关键字已保存'); } catch { showToast('JSON格式错误'); }
    };
    // 保存业务线关键词（保留原始行为：尝试解析 daojia 和 other 文本域）
    document.getElementById('btn-config-bizline-save').onclick = () => {
        try {
            const zhongbao = JSON.parse(document.getElementById('config-bizline-zhongbao').value);
            const daojia = JSON.parse(document.getElementById('config-bizline-daojia').value);
            const daodian = JSON.parse(document.getElementById('config-bizline-daodian').value);
            let other = [];
            const otherRaw = document.getElementById('config-bizline-other').value.trim();
            if (otherRaw) {
                other = JSON.parse(otherRaw);
            }
            if (!Array.isArray(zhongbao) || !Array.isArray(daojia) || !Array.isArray(daodian) || !Array.isArray(other)) throw new Error('必须是数组');
            saveBusinessLineConfig({ zhongbao, daojia, daodian, other });
            showToast('业务线关键词已保存');
        } catch (e) { showToast('JSON格式错误: ' + e.message); }
    };
    // 重置所有配置
    document.getElementById('btn-config-reset').onclick = () => {
        if (confirm('确定要重置所有配置为默认值吗？')) {
            localStorage.removeItem('devops_config_roles');
            localStorage.removeItem('devops_config_milestones');
            localStorage.removeItem('devops_config_criticalKeywords');
            localStorage.removeItem('devops_config_businessLine');
            renderConfigCenter();
            showToast('配置已重置');
        }
    };
}
