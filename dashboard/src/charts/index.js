/**
 * 图表渲染模块
 * 基于 Chart.js (CDN) 渲染历史趋势图、状态分布图、类别占比图、负载分布图、燃尽图
 */

import { state } from '../state/index.js';
import { isItemCompleted } from '../utils/index.js';

// 燃尽图实例引用（独立于 state.charts 管理）
let burndownChartInstance = null;

/**
 * 获取 Chart.js 默认配置
 * 包含响应式布局、图例样式、提示框样式和坐标轴样式
 * @returns {Object} Chart.js 配置对象
 */
export const getChartDefaults = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                color: '#94a3b8',
                font: { family: 'Inter', size: 11 }
            }
        },
        tooltip: {
            backgroundColor: '#111625',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255, 255, 255, 0.08)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 6,
            bodyFont: { family: 'Inter' }
        }
    },
    scales: {
        x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        },
        y: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        }
    }
});

/**
 * 渲染历史趋势折线图
 * @param {Array} history - 历史快照数组
 */
export function renderHistoryChart(history) {
    const ctx = document.getElementById('chart-history').getContext('2d');

    // 销毁上一实例
    if (state.charts['history']) state.charts['history'].destroy();

    const labels = history.map(x => x.date);
    const totalData = history.map(x => x.total);
    const completedData = history.map(x => x.completed);

    // 发光渐变
    const gradientCyan = ctx.createLinearGradient(0, 0, 0, 300);
    gradientCyan.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
    gradientCyan.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

    const gradientEmerald = ctx.createLinearGradient(0, 0, 0, 300);
    gradientEmerald.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
    gradientEmerald.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    state.charts['history'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '任务总数 (Total)',
                    data: totalData,
                    borderColor: '#00f2fe',
                    backgroundColor: gradientCyan,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointBackgroundColor: '#00f2fe',
                    pointRadius: 3
                },
                {
                    label: '已完成任务数 (Completed)',
                    data: completedData,
                    borderColor: '#10b981',
                    backgroundColor: gradientEmerald,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 3
                }
            ]
        },
        options: {
            ...getChartDefaults(),
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

/**
 * 渲染水平条形图：状态分布
 * @param {Array} items - 当前工作项列表
 */
export function renderStatusChart(items) {
    const ctx = document.getElementById('chart-status').getContext('2d');
    if (state.charts['status']) state.charts['status'].destroy();

    // 根据筛选模式过滤活跃或全部项
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // 动态更新图表标题
    const titleElem = document.getElementById('chart-status').closest('.chart-card').querySelector('.chart-title');
    if (titleElem) {
        titleElem.textContent = state.chartStatusMode === 'active' ? '📊 活跃状态看板分布' : '📊 全量状态看板分布';
    }

    const statusCounts = {};
    filteredItems.forEach(x => {
        const status = x.status || '待处理';
        const cat = x.category || 'Req';
        if (!statusCounts[status]) {
            statusCounts[status] = { Req: 0, Task: 0, Bug: 0 };
        }
        statusCounts[status][cat] = (statusCounts[status][cat] || 0) + 1;
    });

    // 按状态总数降序排列
    const sortedStatus = Object.entries(statusCounts).sort((a, b) => {
        const totalA = a[1].Req + a[1].Task + a[1].Bug;
        const totalB = b[1].Req + b[1].Task + b[1].Bug;
        return totalB - totalA;
    });

    const labels = sortedStatus.map(x => x[0]);
    const reqData = sortedStatus.map(x => x[1].Req);
    const taskData = sortedStatus.map(x => x[1].Task);
    const bugData = sortedStatus.map(x => x[1].Bug);

    const emptyLabel = state.chartStatusMode === 'active' ? '无活跃任务' : '无任务';

    state.charts['status'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : [emptyLabel],
            datasets: [
                {
                    label: '产品需求',
                    data: labels.length > 0 ? reqData : [0],
                    backgroundColor: 'rgba(0, 242, 254, 0.6)',
                    borderColor: '#00f2fe',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '开发任务',
                    data: labels.length > 0 ? taskData : [0],
                    backgroundColor: 'rgba(157, 78, 221, 0.6)',
                    borderColor: '#9d4edd',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '缺陷',
                    data: labels.length > 0 ? bugData : [0],
                    backgroundColor: 'rgba(244, 63, 94, 0.6)',
                    borderColor: '#f43f5e',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            ...getChartDefaults(),
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 10 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        footer: (tooltipItems) => {
                            let sum = 0;
                            tooltipItems.forEach(function(tooltipItem) {
                                sum += tooltipItem.parsed.x;
                            });
                            return '总计: ' + sum + ' 个工作项';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { precision: 0 }
                },
                y: {
                    stacked: true,
                    grid: { display: false }
                }
            }
        }
    });
}

/**
 * 渲染环形图：工作项类别占比
 * @param {Array} items - 当前工作项列表
 */
export function renderTypeChart(items) {
    const ctx = document.getElementById('chart-type').getContext('2d');
    if (state.charts['type']) state.charts['type'].destroy();

    // 根据筛选模式过滤
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // 动态更新图表标题
    const titleElem = document.getElementById('chart-type').closest('.chart-card').querySelector('.chart-title');
    if (titleElem) {
        titleElem.textContent = state.chartStatusMode === 'active' ? '🍩 活跃工作项类别占比' : '🍩 工作项类别占比';
    }

    // 按类别统计
    const catCounts = { Req: 0, Task: 0, Bug: 0 };
    filteredItems.forEach(x => {
        const cat = x.category || 'Req';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const labels = ['产品需求', '开发任务', '缺陷'];
    const data = [catCounts.Req, catCounts.Task, catCounts.Bug];

    const bgColors = [
        'rgba(0, 242, 254, 0.6)',
        'rgba(157, 78, 221, 0.6)',
        'rgba(244, 63, 94, 0.6)'
    ];

    state.charts['type'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderColor: 'rgba(10, 13, 20, 0.8)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (tooltipItem) => {
                            const val = tooltipItem.raw;
                            const total = data.reduce((a, b) => a + b, 0);
                            const percent = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                            return ` ${tooltipItem.label}: ${val} 个 (${percent}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * 渲染条形图：团队负载分布（按负责人）
 * @param {Array} items - 当前工作项列表
 */
export function renderWorkloadChart(items) {
    const ctx = document.getElementById('chart-workload').getContext('2d');
    if (state.charts['workload']) state.charts['workload'].destroy();

    // 根据筛选模式过滤
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // 动态更新图表标题
    const titleElem = document.getElementById('chart-workload').closest('.chart-card').querySelector('.chart-title');
    if (titleElem) {
        titleElem.textContent = state.chartStatusMode === 'active' ? '👥 团队活跃负载分布 (负责人)' : '👥 团队全量负载分布 (负责人)';
    }

    const loadCounts = {};
    filteredItems.forEach(x => {
        const person = x.assignee || '未指派';
        const cat = x.category || 'Req';
        if (!loadCounts[person]) {
            loadCounts[person] = { Req: 0, Task: 0, Bug: 0 };
        }
        loadCounts[person][cat] = (loadCounts[person][cat] || 0) + 1;
    });

    // 按总负载降序排列，取前 10 名
    const sortedLoad = Object.entries(loadCounts).sort((a, b) => {
        const totalA = a[1].Req + a[1].Task + a[1].Bug;
        const totalB = b[1].Req + b[1].Task + b[1].Bug;
        return totalB - totalA;
    }).slice(0, 10);

    const labels = sortedLoad.map(x => x[0]);
    const reqData = sortedLoad.map(x => x[1].Req);
    const taskData = sortedLoad.map(x => x[1].Task);
    const bugData = sortedLoad.map(x => x[1].Bug);

    const emptyLabel = state.chartStatusMode === 'active' ? '暂无活跃分配' : '暂无分配';

    state.charts['workload'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : [emptyLabel],
            datasets: [
                {
                    label: '产品需求',
                    data: labels.length > 0 ? reqData : [0],
                    backgroundColor: 'rgba(0, 242, 254, 0.6)',
                    borderColor: '#00f2fe',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '开发任务',
                    data: labels.length > 0 ? taskData : [0],
                    backgroundColor: 'rgba(157, 78, 221, 0.6)',
                    borderColor: '#9d4edd',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '缺陷',
                    data: labels.length > 0 ? bugData : [0],
                    backgroundColor: 'rgba(244, 63, 94, 0.6)',
                    borderColor: '#f43f5e',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            ...getChartDefaults(),
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 10 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        footer: (tooltipItems) => {
                            let sum = 0;
                            tooltipItems.forEach(function(tooltipItem) {
                                sum += tooltipItem.parsed.y;
                            });
                            return '总负载: ' + sum + ' 个工作项';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { precision: 0 }
                }
            }
        }
    });
}

/**
 * 渲染燃尽图
 * 对比理想燃尽线与实际完成数，展示项目进度趋势
 * @param {Array} items - 当前工作项列表
 * @param {Array} history - 历史快照数组
 */
export function renderBurndownChart(items, history) {
    const canvas = document.getElementById('chart-burndown');
    if (!canvas) return;
    if (burndownChartInstance) burndownChartInstance.destroy();

    const active = items.filter(i => {
        const s = i.status || '';
        return !isItemCompleted(i) && !['已取消', '已拒绝'].some(cs => s.includes(cs));
    }).length;
    const total = items.filter(i => {
        const s = i.status || '';
        return !['已取消', '已拒绝'].some(cs => s.includes(cs));
    }).length;

    const dailySnapshots = history.slice(-30);
    const labels = dailySnapshots.map(s => {
        const d = s.date || s.snapshot_date || '';
        return d.length >= 10 ? d.substring(5, 10) : d;
    });
    const ideal = labels.map((_, i) => Math.round(total - (total * i / Math.max(1, labels.length - 1))));
    const actual = dailySnapshots.map(s => (s.completed || s.done || 0));

    burndownChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: '理想燃尽线', data: ideal, borderColor: 'rgba(148,163,184,0.4)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
                { label: '实际完成数', data: actual, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#38bdf8', fill: true, tension: 0.3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
            }
        }
    });
}
