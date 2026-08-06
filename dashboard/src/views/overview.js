/**
 * 数据看板总览视图模块
 * 渲染 KPI 卡片、趋势指标、图表和风险雷达
 */

import { state } from '../state/index.js';
import { isItemCompleted, getBusinessLine, escapeHtml } from '../utils/index.js';

// 动态导入图表渲染（避免循环依赖）
let _chartFns = null;
async function getChartFns() {
    if (!_chartFns) {
        const mod = await import('../charts/index.js');
        _chartFns = mod;
    }
    return _chartFns;
}

let _renderGanttChart = null;
async function getRenderGanttChart() {
    if (!_renderGanttChart) {
        const mod = await import('../charts/gantt.js');
        _renderGanttChart = mod.renderGanttChart;
    }
    return _renderGanttChart;
}

let _renderRiskRadar = null;
async function getRenderRiskRadar() {
    if (!_renderRiskRadar) {
        const mod = await import('../views/risk.js');
        _renderRiskRadar = mod.renderRiskRadar;
    }
    return _renderRiskRadar;
}

/**
 * 设置趋势文本（带涨跌箭头和颜色）
 * @param {string} id - DOM 元素 ID
 * @param {number} delta - 变化值
 * @param {string} suffix - 单位后缀
 * @param {boolean} invertColor - 是否反转颜色（如交付周期越短越好）
 * @param {boolean} isPercent - 是否为百分比值
 */
function setTrendText(id, delta, suffix, invertColor = false, isPercent = false) {
    const elem = document.getElementById(id);
    let classVal = 'trend-indicator';
    let text = '';

    if (delta > 0) {
        classVal += invertColor ? ' down' : ' up';
        text = `↑ +${isPercent ? delta.toFixed(1) : delta} ${suffix}`;
    } else if (delta < 0) {
        classVal += invertColor ? ' up' : ' down';
        text = `↓ ${isPercent ? delta.toFixed(1) : delta} ${suffix}`;
    } else {
        text = `持平 ${suffix}`;
    }
    elem.textContent = text;
    elem.className = classVal;
}

/**
 * 渲染数据看板总览视图
 * 包含需求/任务/缺陷 KPI、业务线 KPI、趋势图表和风险雷达
 */
export async function renderOverviewDashboard() {
    const items = state.latest[state.currentProject] || [];
    const history = state.history[state.currentProject] || [];

    const pendingList = ['待处理', '待开发', '未开始', '待确认'];

    // 需求视角 KPI
    const reqItems = items.filter(x => x.category === 'Req');
    const reqTotal = reqItems.length;
    const reqCompleted = reqItems.filter(x => isItemCompleted(x)).length;
    const reqActive = reqItems.filter(x => !isItemCompleted(x) && !pendingList.includes(x.status)).length;
    const reqPending = reqItems.filter(x => pendingList.includes(x.status)).length;
    const reqRate = reqTotal > 0 ? ((reqCompleted / reqTotal) * 100).toFixed(1) : '0.0';

    // 任务与缺陷视角 KPI
    const taskItems = items.filter(x => x.category === 'Task');
    const taskTotal = taskItems.length;
    const taskCompleted = taskItems.filter(x => isItemCompleted(x)).length;
    const taskActive = taskItems.filter(x => !isItemCompleted(x)).length;
    const taskRate = taskTotal > 0 ? ((taskCompleted / taskTotal) * 100).toFixed(1) : '0.0';

    const bugItems = items.filter(x => x.category === 'Bug');
    const bugActive = bugItems.filter(x => !isItemCompleted(x)).length;

    // 填充需求 KPI
    document.getElementById('kpi-req-total').textContent = reqTotal;
    document.getElementById('kpi-req-completed').textContent = reqCompleted;
    document.getElementById('kpi-req-active').textContent = reqActive;
    document.getElementById('kpi-req-pending').textContent = reqPending;
    document.getElementById('kpi-req-rate').textContent = `${reqRate}%`;

    // 填充任务/缺陷 KPI
    document.getElementById('kpi-task-total').textContent = taskTotal;
    document.getElementById('kpi-task-completed').textContent = taskCompleted;
    document.getElementById('kpi-task-active').textContent = taskActive;
    document.getElementById('kpi-task-rate').textContent = `${taskRate}%`;
    document.getElementById('kpi-bug-active').textContent = bugActive;

    // 业务线 KPI
    const bizZhongbao = items.filter(x => getBusinessLine(x) === 'zhongbao');
    const bizDaojia = items.filter(x => getBusinessLine(x) === 'daojia');
    const bizDaodian = items.filter(x => getBusinessLine(x) === 'daodian');
    const D = x => isItemCompleted(x) ? 0 : 1;
    document.getElementById('kpi-zhongbao-total').textContent = bizZhongbao.length;
    document.getElementById('kpi-zhongbao-active').textContent = bizZhongbao.reduce((acc, x) => acc + D(x), 0);
    document.getElementById('kpi-daojia-total').textContent = bizDaojia.length;
    document.getElementById('kpi-daojia-active').textContent = bizDaojia.reduce((acc, x) => acc + D(x), 0);
    document.getElementById('kpi-daodian-total').textContent = bizDaodian.length;
    document.getElementById('kpi-daodian-active').textContent = bizDaodian.reduce((acc, x) => acc + D(x), 0);

    // 任务趋势对比历史首日
    if (history.length > 1) {
        const baseline = history[0];
        const latestHist = history[history.length - 1];

        const deltaTotal = latestHist.total - baseline.total;
        setTrendText('kpi-task-total-trend', deltaTotal, '任务变动');

        const baselineRate = baseline.total > 0 ? (baseline.completed / baseline.total * 100) : 0;
        const currentRate = parseFloat(taskRate);
        const deltaRate = currentRate - baselineRate;
        setTrendText('kpi-task-rate-trend', deltaRate, '%', false, true);
    } else {
        ['kpi-task-total-trend', 'kpi-task-rate-trend'].forEach(id => {
            document.getElementById(id).textContent = '历史数据积累中';
            document.getElementById(id).className = 'trend-indicator';
        });
    }

    // 需求卡片静态子文本
    document.getElementById('kpi-req-total-trend').textContent = '全部版本需求';
    document.getElementById('kpi-req-total-trend').className = 'trend-indicator';
    document.getElementById('kpi-req-completed-trend').textContent = '测试通过/已上线';
    document.getElementById('kpi-req-completed-trend').className = 'trend-indicator';
    document.getElementById('kpi-req-active-trend').textContent = '开发与测试中';
    document.getElementById('kpi-req-active-trend').className = 'trend-indicator';
    document.getElementById('kpi-req-pending-trend').textContent = '未开始/待排期';
    document.getElementById('kpi-req-pending-trend').className = 'trend-indicator';
    document.getElementById('kpi-req-rate-trend').textContent = '已完成/总计';
    document.getElementById('kpi-req-rate-trend').className = 'trend-indicator';

    // 任务卡片静态子文本
    document.getElementById('kpi-task-completed-trend').textContent = '完成验证/提交测试';
    document.getElementById('kpi-task-completed-trend').className = 'trend-indicator';
    document.getElementById('kpi-task-active-trend').textContent = '开发中/待开发/未开始';
    document.getElementById('kpi-task-active-trend').className = 'trend-indicator';
    document.getElementById('kpi-bug-active-trend').textContent = '未修复缺陷';
    document.getElementById('kpi-bug-active-trend').className = 'trend-indicator';

    // 交付周期 KPI
    const kpiLeadTime = state.leadTimeKPI[state.currentProject] || { average: 0, delta: 0 };
    const avgVal = parseFloat(kpiLeadTime.average) || 0.0;
    const deltaVal = parseFloat(kpiLeadTime.delta) || 0.0;
    document.getElementById('kpi-lead-time-value').textContent = `${avgVal.toFixed(1)} 天`;
    setTrendText('kpi-lead-time-trend', deltaVal, '天', true, false);

    // 渲染图表和风险雷达
    const chartFns = await getChartFns();
    chartFns.renderHistoryChart(history);
    chartFns.renderStatusChart(items);
    chartFns.renderTypeChart(items);
    chartFns.renderWorkloadChart(items);

    const renderGanttChart = await getRenderGanttChart();
    renderGanttChart();

    const renderRiskRadar = await getRenderRiskRadar();
    renderRiskRadar(items);
}
