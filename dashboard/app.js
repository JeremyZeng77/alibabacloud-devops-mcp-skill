// State Management
let state = {
    compiledAt: null,
    latest: { mftb: [], mfood: [] },
    history: { mftb: [], mfood: [] },
    weeklyReports: [],
    currentProject: 'mftb', // 'mftb' or 'mfood'
    currentView: 'overview', // 'overview', 'workitems', 'weekly'
    charts: {}, // Store Chart.js instances
    autoSyncIntervalId: null, // Store interval ID for 5 minutes sync
    chartStatusMode: 'active', // 'active' (进行中) or 'all' (全部)
    ganttViewMode: 'day', // 'day', 'week', or 'month'
    ganttStartDate: null,
    ganttCategory: 'Req' // 'Req', 'Task', or 'Bug'
};

// Helper to check if an item is completed/delivered based on its category
function isItemCompleted(item) {
    const status = item.status || '';
    const cat = item.category || 'Req';
    
    // Statuses that represent terminal/completed states for any item
    const baseCompleted = [
        '已上线', '已关闭', '测试环境验证通过', '测试环境验收通过', 
        '预发布验收通过', '生产验收通过', '产品验收通过', '已完成',
        '已关闭（已修复）', '已关闭（未修复）'
    ];
    
    if (baseCompleted.includes(status)) {
        return true;
    }
    
    // Developer Tasks are considered delivered once they are submitted to testing
    if (cat === 'Task') {
        const testingStatuses = ['提交测试', '测试中', '待测试', '发包已测试', '已提测'];
        if (testingStatuses.includes(status)) {
            return true;
        }
    }
    
    // Defect items that are explicitly deferred or not modified
    if (cat === 'Bug') {
        const inactiveBugStatuses = ['暂不修复'];
        if (inactiveBugStatuses.includes(status)) {
            return true;
        }
    }
    
    return false;
}

const BRIDGE_API_BASE = `http://${window.location.hostname}:18790`;

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    initGanttState();
    initEventListeners();
    initAutoSync();
    loadDashboardData();
    
    // Auto polling every 60 seconds
    setInterval(pollDashboardData, 60000);
});

// Event Listeners
function initEventListeners() {
    // Project Tabs (MFTB vs mFood)
    document.querySelectorAll('.project-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.currentProject = e.currentTarget.dataset.project;
            
            // Re-render current view with new project data
            renderCurrentView();
        });
    });

    // View Navigation Tabs (Overview, Table, Weekly)
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.currentView = e.currentTarget.dataset.view;
            
            // Toggle view panels
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
            document.getElementById(`view-${state.currentView}`).classList.add('active');
            
            renderCurrentView();
        });
    });

    // Compile Button Click
    document.getElementById('btn-sync-compile').addEventListener('click', triggerSyncCompile);

    // Close Modal Button
    document.getElementById('btn-close-modal').addEventListener('click', hideModal);
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('detail-modal')) hideModal();
    });

    // Weekly Report selector
    document.getElementById('weekly-week-select').addEventListener('change', (e) => {
        renderWeeklyReport(e.target.value);
    });

    // Filters event listeners
    ['filter-search', 'filter-category', 'filter-status', 'filter-assignee', 'filter-priority', 'filter-iteration'].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            elem.addEventListener('input', applyFilters);
            elem.addEventListener('change', applyFilters);
        }
    });

    // Chart status mode toggle tabs
    document.querySelectorAll('.chart-status-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.chart-status-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.chartStatusMode = e.currentTarget.dataset.statusMode;
            
            // Re-render dashboard charts
            if (state.currentView === 'overview') {
                const items = state.latest[state.currentProject] || [];
                renderStatusChart(items);
                renderTypeChart(items);
                renderWorkloadChart(items);
                renderGanttChart();
            }
        });
    });

    // Gantt view mode selector buttons
    document.querySelectorAll('.gantt-view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.gantt-view-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            setGanttViewMode(e.currentTarget.dataset.view);
            renderGanttChart();
        });
    });

    // Gantt navigation buttons
    document.getElementById('gantt-btn-today').addEventListener('click', () => {
        setGanttViewMode(state.ganttViewMode);
        renderGanttChart();
    });

    document.getElementById('gantt-btn-prev').addEventListener('click', () => {
        shiftGanttTimeline(-1);
    });

    document.getElementById('gantt-btn-next').addEventListener('click', () => {
        shiftGanttTimeline(1);
    });

    // Gantt category selector tabs
    document.querySelectorAll('.gantt-category-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.gantt-category-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.ganttCategory = e.currentTarget.dataset.ganttCat;
            renderGanttChart();
        });
    });
}

// Auto Sync Manager
function initAutoSync() {
    const chk = document.getElementById('chk-auto-sync');
    if (!chk) return;

    // Load from localStorage
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
            // Trigger compile immediately
            triggerSyncCompileSilent();
        } else {
            stopAutoSyncTimer();
            showToast('已关闭定时自动更新');
        }
    });
}

function startAutoSyncTimer() {
    stopAutoSyncTimer(); // Clear existing
    state.autoSyncIntervalId = setInterval(() => {
        triggerSyncCompileSilent();
    }, 300000); // 5 minutes
}

// Stop Auto Sync
function stopAutoSyncTimer() {
    if (state.autoSyncIntervalId) {
        clearInterval(state.autoSyncIntervalId);
        state.autoSyncIntervalId = null;
    }
}

async function triggerSyncCompileSilent() {
    console.log('Background auto compile triggered...');
    try {
        const response = await fetch(`${BRIDGE_API_BASE}/compile`, { method: 'GET' });
        const res = await response.json();
        if (response.ok && res.ok) {
            console.log('Background compile succeeded, reloading data...');
            loadDashboardData();
        }
    } catch (err) {
        console.warn('Background auto-sync failed:', err);
    }
}

// Load Data from local JSON
async function loadDashboardData() {
    try {
        const response = await fetch('./projects_data.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Data file not found');
        const db = await response.json();
        
        // Update state
        state.compiledAt = db.compiledAt;
        state.latest = db.latest;
        state.history = db.history;
        state.weeklyReports = db.weeklyReports || [];

        // Update timestamps
        updateTimestamps();

        // Populate weekly selector once
        populateWeeklySelector();
        
        // Render dashboard
        renderCurrentView();
        
    } catch (err) {
        console.error('Failed to load dashboard data:', err);
        showToast('无法加载本地 JSON 数据库，请确保已运行编译脚本。');
    }
}

// Poll data silently in background
async function pollDashboardData() {
    try {
        const response = await fetch('./projects_data.json?t=' + new Date().getTime());
        if (!response.ok) return;
        const db = await response.json();
        
        if (state.compiledAt !== db.compiledAt) {
            console.log('Detect database updates, auto-refreshing...');
            state.compiledAt = db.compiledAt;
            state.latest = db.latest;
            state.history = db.history;
            state.weeklyReports = db.weeklyReports || [];
            
            updateTimestamps();
            renderCurrentView();
            showToast('已自动同步最新数据。');
        }
    } catch (err) {
        // Silent fail for background poll
    }
}

// Trigger recompile on bridge server
async function triggerSyncCompile() {
    const btn = document.getElementById('btn-sync-compile');
    btn.classList.add('spinning');
    showToast('正在向本地桥接服务发送编译指令...');

    try {
        const response = await fetch(`${BRIDGE_API_BASE}/compile`, { method: 'GET' });
        const res = await response.json();
        
        if (response.ok && res.ok) {
            showToast('编译成功！正在加载最新看板数据...');
            // Wait 500ms and reload JSON
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

// Update UI Timestamps
function updateTimestamps() {
    // Compiled time
    if (state.compiledAt) {
        const date = new Date(state.compiledAt);
        document.getElementById('time-compiled').textContent = formatDate(date);
    } else {
        document.getElementById('time-compiled').textContent = 'N/A';
    }

    // Collected time (from latest item snapshot receivedAt)
    const latestItems = state.latest[state.currentProject] || [];
    if (latestItems.length > 0) {
        let latestDate = null;
        latestItems.forEach(item => {
            if (item.planStart) {
                const itemDate = new Date(item.planStart);
                if (!isNaN(itemDate) && (!latestDate || itemDate > latestDate)) {
                    latestDate = itemDate;
                }
            }
        });
        document.getElementById('time-collected').textContent = latestDate ? latestDate.toISOString().slice(0, 10) : '最新数据';
    } else {
        document.getElementById('time-collected').textContent = 'N/A';
    }
}

// Helper to Format Dates
function formatDate(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Populate Weekly Selector Dropdown
function populateWeeklySelector() {
    const select = document.getElementById('weekly-week-select');
    const prevValue = select.value;
    select.innerHTML = '';

    if (state.weeklyReports.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '暂无周报记录';
        select.appendChild(opt);
        return;
    }

    // Sort weeks descending (newest first)
    state.weeklyReports.forEach((rep) => {
        const opt = document.createElement('option');
        opt.value = rep.week;
        opt.textContent = `周期：${rep.week}`;
        select.appendChild(opt);
    });

    // Select the first (newest) or restore previous
    if (prevValue && state.weeklyReports.some(r => r.week === prevValue)) {
        select.value = prevValue;
    } else {
        select.value = state.weeklyReports[0].week;
    }

    renderWeeklyReport(select.value);
}

// Render Current View
function renderCurrentView() {
    updateTimestamps();
    
    if (state.currentView === 'overview') {
        renderOverviewDashboard();
    } else if (state.currentView === 'workitems') {
        populateFilters();
        applyFilters();
    } else if (state.currentView === 'weekly') {
        populateWeeklySelector();
    }
}

// VIEW 1: Render Overview Dashboard
function renderOverviewDashboard() {
    const items = state.latest[state.currentProject] || [];
    const history = state.history[state.currentProject] || [];

    // Pending definitions:
    const pendingList = ['待处理', '待开发', '未开始', '待确认'];

    // Row 1: Requirements View
    const reqItems = items.filter(x => x.category === 'Req');
    const reqTotal = reqItems.length;
    const reqCompleted = reqItems.filter(x => isItemCompleted(x)).length;
    const reqActive = reqItems.filter(x => !isItemCompleted(x) && !pendingList.includes(x.status)).length;
    const reqPending = reqItems.filter(x => pendingList.includes(x.status)).length;
    const reqRate = reqTotal > 0 ? ((reqCompleted / reqTotal) * 100).toFixed(1) : '0.0';

    // Row 2: Tasks & Defects View
    const taskItems = items.filter(x => x.category === 'Task');
    const taskTotal = taskItems.length;
    const taskCompleted = taskItems.filter(x => isItemCompleted(x)).length;
    const taskActive = taskItems.filter(x => !isItemCompleted(x)).length;
    const taskRate = taskTotal > 0 ? ((taskCompleted / taskTotal) * 100).toFixed(1) : '0.0';

    const bugItems = items.filter(x => x.category === 'Bug');
    const bugActive = bugItems.filter(x => !isItemCompleted(x)).length;

    // Populate Row 1 KPIs (Requirements View)
    document.getElementById('kpi-req-total').textContent = reqTotal;
    document.getElementById('kpi-req-completed').textContent = reqCompleted;
    document.getElementById('kpi-req-active').textContent = reqActive;
    document.getElementById('kpi-req-pending').textContent = reqPending;
    document.getElementById('kpi-req-rate').textContent = `${reqRate}%`;

    // Populate Row 2 KPIs (Tasks/Bugs View)
    document.getElementById('kpi-task-total').textContent = taskTotal;
    document.getElementById('kpi-task-completed').textContent = taskCompleted;
    document.getElementById('kpi-task-active').textContent = taskActive;
    document.getElementById('kpi-task-rate').textContent = `${taskRate}%`;
    document.getElementById('kpi-bug-active').textContent = bugActive;

    // Populate Task KPI Trends compared to first history day
    if (history.length > 1) {
        const baseline = history[0]; // First day in history log
        const latestHist = history[history.length - 1]; // Latest day
        
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

    // Static/default subtext values for Requirements (Row 1)
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

    // Static/default subtext values for remaining task cards
    document.getElementById('kpi-task-completed-trend').textContent = '完成验证/提交测试';
    document.getElementById('kpi-task-completed-trend').className = 'trend-indicator';

    document.getElementById('kpi-task-active-trend').textContent = '开发中/待开发/未开始';
    document.getElementById('kpi-task-active-trend').className = 'trend-indicator';

    document.getElementById('kpi-bug-active-trend').textContent = '未修复缺陷';
    document.getElementById('kpi-bug-active-trend').className = 'trend-indicator';

    // Render Charts
    renderHistoryChart(history);
    renderStatusChart(items);
    renderTypeChart(items);
    renderWorkloadChart(items);
    renderGanttChart();
}

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

// Charts Custom Configuration Helper
const getChartDefaults = () => ({
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

// Render Line Chart: History Timeline
function renderHistoryChart(history) {
    const ctx = document.getElementById('chart-history').getContext('2d');
    
    // Destroy previous
    if (state.charts['history']) state.charts['history'].destroy();

    const labels = history.map(x => x.date);
    const totalData = history.map(x => x.total);
    const completedData = history.map(x => x.completed);

    // Glowing gradients
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

// Render Horizontal Bar Chart: Active/All Status Breakdown
function renderStatusChart(items) {
    const ctx = document.getElementById('chart-status').getContext('2d');
    if (state.charts['status']) state.charts['status'].destroy();

    // Group active or all items based on filter mode
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // Update chart title dynamically
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

    // Sort descending by total items in status
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
                    backgroundColor: 'rgba(0, 242, 254, 0.6)',  // Cyan
                    borderColor: '#00f2fe',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '开发任务',
                    data: labels.length > 0 ? taskData : [0],
                    backgroundColor: 'rgba(157, 78, 221, 0.6)', // Purple
                    borderColor: '#9d4edd',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '缺陷',
                    data: labels.length > 0 ? bugData : [0],
                    backgroundColor: 'rgba(244, 63, 94, 0.6)',  // Rose
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

// Render Doughnut Chart: Categories Ratio
function renderTypeChart(items) {
    const ctx = document.getElementById('chart-type').getContext('2d');
    if (state.charts['type']) state.charts['type'].destroy();

    // Filter active or all items based on filter mode
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // Update chart title dynamically
    const titleElem = document.getElementById('chart-type').closest('.chart-card').querySelector('.chart-title');
    if (titleElem) {
        titleElem.textContent = state.chartStatusMode === 'active' ? '🍩 活跃工作项类别占比' : '🍩 工作项类别占比';
    }

    // Count active items or all items per category
    const catCounts = { Req: 0, Task: 0, Bug: 0 };
    filteredItems.forEach(x => {
        const cat = x.category || 'Req';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const labels = ['产品需求', '开发任务', '缺陷'];
    const data = [catCounts.Req, catCounts.Task, catCounts.Bug];

    const bgColors = [
        'rgba(0, 242, 254, 0.6)',  // Cyan
        'rgba(157, 78, 221, 0.6)', // Purple
        'rgba(244, 63, 94, 0.6)'   // Rose
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

// Render Active/All Dev/QA Workload
function renderWorkloadChart(items) {
    const ctx = document.getElementById('chart-workload').getContext('2d');
    if (state.charts['workload']) state.charts['workload'].destroy();

    // Count active or all items per assignee based on mode
    const filteredItems = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // Update chart title dynamically
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

    // Sort assignees by their total workload descending
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
                    backgroundColor: 'rgba(0, 242, 254, 0.6)',  // Cyan
                    borderColor: '#00f2fe',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '开发任务',
                    data: labels.length > 0 ? taskData : [0],
                    backgroundColor: 'rgba(157, 78, 221, 0.6)', // Purple
                    borderColor: '#9d4edd',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: '缺陷',
                    data: labels.length > 0 ? bugData : [0],
                    backgroundColor: 'rgba(244, 63, 94, 0.6)',  // Rose
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

// VIEW 2: Populate dropdown filters for list view
function populateFilters() {
    const allItems = state.latest[state.currentProject] || [];
    const categoryVal = document.getElementById('filter-category').value;
    
    // Filter items based on selected category to make dropdown options relevant
    const items = categoryVal === 'all' ? allItems : allItems.filter(x => x.category === categoryVal);
    
    // Status
    const statusSelect = document.getElementById('filter-status');
    const prevStatus = statusSelect.value;
    statusSelect.innerHTML = '<option value="all">全部状态</option>';
    const statuses = [...new Set(items.map(x => x.status))].filter(Boolean);
    statuses.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        statusSelect.appendChild(opt);
    });
    statusSelect.value = prevStatus && statuses.includes(prevStatus) ? prevStatus : 'all';

    // Assignee
    const assSelect = document.getElementById('filter-assignee');
    const prevAss = assSelect.value;
    assSelect.innerHTML = '<option value="all">全部负责人</option>';
    const assignees = [...new Set(items.map(x => x.assignee))].filter(Boolean);
    assignees.forEach(ass => {
        const opt = document.createElement('option');
        opt.value = ass;
        opt.textContent = ass;
        assSelect.appendChild(opt);
    });
    assSelect.value = prevAss && assignees.includes(prevAss) ? prevAss : 'all';

    // Iteration
    const iterSelect = document.getElementById('filter-iteration');
    const prevIter = iterSelect.value;
    iterSelect.innerHTML = '<option value="all">全部迭代</option>';
    const iterations = [...new Set(items.map(x => x.iteration))].filter(Boolean);
    iterations.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it;
        opt.textContent = it;
        iterSelect.appendChild(opt);
    });
    iterSelect.value = prevIter && iterations.includes(prevIter) ? prevIter : 'all';
}

// Apply table filters and render list
function applyFilters() {
    // Dynamically rebuild status, assignee, iteration lists based on selected category
    populateFilters();

    const items = state.latest[state.currentProject] || [];
    const searchVal = document.getElementById('filter-search').value.toLowerCase().trim();
    const categoryVal = document.getElementById('filter-category').value;
    const statusVal = document.getElementById('filter-status').value;
    const assVal = document.getElementById('filter-assignee').value;
    const prioVal = document.getElementById('filter-priority').value;
    const iterVal = document.getElementById('filter-iteration').value;

    const filtered = items.filter(x => {
        // Search
        if (searchVal) {
            const matchTitle = x.title.toLowerCase().includes(searchVal);
            const matchRow = (x.rowText || '').toLowerCase().includes(searchVal);
            const matchId = (x.id || '').toLowerCase().includes(searchVal);
            if (!matchTitle && !matchRow && !matchId) return false;
        }
        // Category
        if (categoryVal !== 'all' && x.category !== categoryVal) return false;
        // Status
        if (statusVal !== 'all' && x.status !== statusVal) return false;
        // Assignee
        if (assVal !== 'all' && x.assignee !== assVal) return false;
        // Priority
        if (prioVal !== 'all' && x.priority !== prioVal) return false;
        // Iteration
        if (iterVal !== 'all' && x.iteration !== iterVal) return false;

        return true;
    });

    const categoryText = categoryVal === 'Req' ? '需求' : (categoryVal === 'Task' ? '任务' : (categoryVal === 'Bug' ? '缺陷' : '工作项'));
    document.getElementById('filtered-count-text').textContent = `共找到 ${filtered.length} 条符合条件的${categoryText}`;
    
    // Update table header dynamically
    const tableHeader = document.querySelector('#table-workitems th:nth-child(2)');
    if (tableHeader) {
        tableHeader.textContent = categoryVal === 'Req' ? '需求标题' : (categoryVal === 'Task' ? '任务标题' : (categoryVal === 'Bug' ? '缺陷标题' : '标题'));
    }

    // Render tbody
    const tbody = document.getElementById('table-tbody');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px 0;">未找到符合过滤条件的数据项目</td>`;
        tbody.appendChild(tr);
        return;
    }

    const fallbackPrefix = categoryVal === 'Req' ? 'REQ-' : (categoryVal === 'Task' ? 'TASK-' : (categoryVal === 'Bug' ? 'BUG-' : 'ID-'));

    filtered.forEach((item, index) => {
        const tr = document.createElement('tr');
        
        // Setup row click trigger detail modal
        tr.addEventListener('click', () => showItemDetail(item));

        // Format priority class
        let prioBadge = `<span class="badge badge-prio-${item.priority}">${item.priority}</span>`;
        
        // Format status class
        let statusClass = 'badge-status-pending';
        const completedList = ['已上线', '已关闭', '生产验收通过', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'];
        const testingList = ['测试中', '待测试', '提交测试', '发包已测试', '已提测'];
        const progressList = ['开发中', '待开发', '待处理', '方案设计中', '产品方案已确认', '处理中', '设计中', '需产品梳理/确认'];
        
        if (completedList.includes(item.status)) statusClass = 'badge-status-completed';
        else if (testingList.includes(item.status)) statusClass = 'badge-status-testing';
        else if (progressList.includes(item.status)) statusClass = 'badge-status-progress';
        else if (item.status === '开发挂起' || item.status === '挂起' || item.status === '暂不修复') statusClass = 'badge-status-blocked';
        
        let statusBadge = `<span class="badge ${statusClass}">${item.status}</span>`;

        tr.innerHTML = `
            <td class="cell-id" style="font-family: monospace; color: var(--color-primary);">${item.id || fallbackPrefix + (index + 1)}</td>
            <td class="cell-title">${escapeHtml(item.title)}</td>
            <td>${statusBadge}</td>
            <td>${prioBadge}</td>
            <td style="color: var(--text-secondary);">${escapeHtml(item.assignee)}</td>
            <td style="color: var(--text-muted);">${escapeHtml(item.creator)}</td>
            <td><span style="font-size: 11px; background: rgba(255,255,255,0.03); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${escapeHtml(item.iteration)}</span></td>
            <td style="color: var(--text-muted); font-size: 12px;">${item.createDate || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// VIEW 3: Render Weekly Report Narratives
function renderWeeklyReport(weekVal) {
    const report = state.weeklyReports.find(r => r.week === weekVal);
    if (!report) {
        ['weekly-progress', 'weekly-planning', 'weekly-assessment', 'weekly-risks', 'weekly-recommendations'].forEach(id => {
            document.getElementById(id).innerHTML = `<div style="color: var(--text-muted)">本周周期暂未编制文字周报</div>`;
        });
        document.getElementById('weekly-metrics-card').style.display = 'none';
        return;
    }

    const projKey = state.currentProject; // 'mftb' or 'mfood'
    const projReport = report[projKey] || report; // Fallback to root if not split

    // Render Metrics if available
    const metricsCard = document.getElementById('weekly-metrics-card');
    if (projReport.metrics && projReport.metrics.trim() && projReport.metrics.trim() !== '<div style="color: var(--text-muted)">暂无编制</div>') {
        metricsCard.style.display = 'block';
        document.getElementById('weekly-metrics').innerHTML = parseNarrativeMarkdown(projReport.metrics);
    } else {
        metricsCard.style.display = 'none';
    }

    document.getElementById('weekly-progress').innerHTML = parseNarrativeMarkdown(projReport.progress);
    document.getElementById('weekly-planning').innerHTML = parseNarrativeMarkdown(projReport.planning);
    document.getElementById('weekly-assessment').innerHTML = parseNarrativeMarkdown(projReport.assessment);
    document.getElementById('weekly-risks').innerHTML = parseNarrativeMarkdown(projReport.risks, true); // highlight warnings
    document.getElementById('weekly-recommendations').innerHTML = parseNarrativeMarkdown(projReport.recommendations);
}

// Simple Markdown narrative formatter with table support
function parseNarrativeMarkdown(text, highlightAlerts = false) {
    if (!text) return '<div style="color: var(--text-muted)">暂无编制</div>';
    
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let inTable = false;
    let isFirstRow = true;

    lines.forEach(line => {
        let l = line.trim();
        if (!l) return;

        // Check tables starting with '|'
        if (l.startsWith('|') && l.endsWith('|')) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            if (!inTable) {
                html += '<table class="weekly-data-table">';
                inTable = true;
                isFirstRow = true;
            }
            
            // Skip alignment row like | --- | --- |
            if (l.includes('---')) {
                return;
            }
            
            const cols = l.split('|').map(x => x.trim()).filter((x, idx, arr) => idx > 0 && idx < arr.length - 1);
            html += '<tr>';
            cols.forEach(col => {
                const tag = isFirstRow ? 'th' : 'td';
                html += `<${tag}>${parseInlineStyles(col)}</${tag}>`;
            });
            html += '</tr>';
            isFirstRow = false;
            return;
        }
        
        // Close table if we are not on a table line
        if (inTable) {
            html += '</table>';
            inTable = false;
        }

        // Check alerts [WARNING] or [IMPORTANT]
        let alertClass = '';
        let isAlert = false;
        if (l.startsWith('[WARNING]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[WARNING]', '<strong>⚠️ 警告:</strong>');
        } else if (l.startsWith('[IMPORTANT]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[IMPORTANT]', '<strong>📢 重要提醒:</strong>');
        } else if (l.startsWith('[NOTE]')) {
            alertClass = 'alert-text-block';
            isAlert = true;
            l = l.replace('[NOTE]', '<strong>ℹ️ 备注:</strong>');
        }

        // Check lists starting with '-'
        if (l.startsWith('-')) {
            if (!inList) {
                html += '<ul class="weekly-bullet-list">';
                inList = true;
            }
            let listContent = l.slice(1).trim();
            listContent = parseInlineStyles(listContent);
            
            if (isAlert) {
                html += `<li class="${alertClass}">${listContent}</li>`;
            } else {
                html += `<li>${listContent}</li>`;
            }
        } else {
            // Close previous list if any
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            
            // Regular line
            let inlineContent = parseInlineStyles(l);
            if (isAlert) {
                html += `<p class="${alertClass}">${inlineContent}</p>`;
            } else {
                html += `<p>${inlineContent}</p>`;
            }
        }
    });

    if (inList) html += '</ul>';
    if (inTable) html += '</table>';
    return html;
}

function parseInlineStyles(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// Show Drill-down Modal
function showItemDetail(item) {
    document.getElementById('modal-item-id').textContent = item.id || '需求详情';
    document.getElementById('modal-item-title').textContent = item.title;
    
    document.getElementById('modal-item-status').textContent = item.status;
    document.getElementById('modal-item-status').className = 'field-value badge ' + getStatusBadgeClass(item.status);
    
    document.getElementById('modal-item-priority').textContent = item.priority;
    document.getElementById('modal-item-priority').className = 'field-value badge badge-prio-' + item.priority;
    
    document.getElementById('modal-item-assignee').textContent = item.assignee;
    document.getElementById('modal-item-creator').textContent = item.creator;
    document.getElementById('modal-item-iteration').textContent = item.iteration;
    document.getElementById('modal-item-type').textContent = item.workItemType;
    
    // Population of creation time and planning dates
    document.getElementById('modal-item-created').textContent = item.createDate || '-';
    document.getElementById('modal-item-start').textContent = item.planStart || '-';
    document.getElementById('modal-item-end').textContent = item.planEnd || '-';
    
    // Ingest terminal row text
    document.getElementById('modal-item-rowtext').textContent = item.rowText;
    
    // Activate Modal
    document.getElementById('detail-modal').classList.add('active');
}

function getStatusBadgeClass(status) {
    const completedList = ['已上线', '已关闭', '生产验收通过', '测试环境验证通过', '测试环境验收通过', '预发布验收通过', '产品验收通过', '已完成', '已关闭（已修复）', '已关闭（未修复）'];
    const testingList = ['测试中', '待测试', '提交测试', '发包已测试', '已提测'];
    const progressList = ['开发中', '待开发', '待处理', '方案设计中', '产品方案已确认', '处理中', '设计中', '需产品梳理/确认'];
    
    if (completedList.includes(status)) return 'badge-status-completed';
    if (testingList.includes(status)) return 'badge-status-testing';
    if (progressList.includes(status)) return 'badge-status-progress';
    if (status === '开发挂起' || status === '挂起' || status === '暂不修复') return 'badge-status-blocked';
    return 'badge-status-pending';
}

function hideModal() {
    document.getElementById('detail-modal').classList.remove('active');
}

// Toast Alert Manager
function showToast(message) {
    const toast = document.getElementById('toast-alert');
    const msg = document.getElementById('toast-message');
    msg.textContent = message;
    
    toast.style.display = 'block';
    // Trigger CSS reflow
    toast.offsetHeight;
    toast.classList.add('active');

    // Hide after 3 seconds
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
        setTimeout(() => {
            toast.style.display = 'none';
        }, 300);
    }, 3500);
}

// HTML Escaper helper
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// ============================================================================
// Gantt Chart (全员任务计划情况) Engine
// ============================================================================

// Initialize Gantt timeline start date centered on today
function initGanttState() {
    state.ganttViewMode = 'day';
    state.ganttCategory = 'Req';
    setGanttViewMode('day');
}

// Adjust Gantt state date window based on mode
function setGanttViewMode(mode) {
    state.ganttViewMode = mode;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (mode === 'day') {
        const start = new Date(today);
        start.setDate(today.getDate() - 4);
        state.ganttStartDate = start;
    } else if (mode === 'week') {
        const start = new Date(today);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Align to Monday
        const monday = new Date(start.setDate(diff));
        monday.setDate(monday.getDate() - 14); // 2 weeks back
        state.ganttStartDate = monday;
    } else if (mode === 'month') {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        state.ganttStartDate = start;
    }
}

// Shift timeline window by direction
function shiftGanttTimeline(direction) {
    const start = new Date(state.ganttStartDate);
    if (state.ganttViewMode === 'day') {
        start.setDate(start.getDate() + direction * 7);
    } else if (state.ganttViewMode === 'week') {
        start.setDate(start.getDate() + direction * 28);
    } else if (state.ganttViewMode === 'month') {
        start.setMonth(start.getMonth() + direction * 2);
    }
    state.ganttStartDate = start;
    renderGanttChart();
}

// Date comparison helpers
function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function getWeekNumber(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function isCurrentWeek(d, today) {
    const w1 = getWeekNumber(d);
    const w2 = getWeekNumber(today);
    return d.getFullYear() === today.getFullYear() && w1 === w2;
}

function isCurrentMonth(d, today) {
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
}

// Render Gantt chart grid, assignees and bars
function renderGanttChart() {
    const container = document.getElementById('gantt-grid-container');
    if (!container) return;
    
    const items = state.latest[state.currentProject] || [];
    
    // Filter active or all items based on active mode toggle
    const activeFiltered = state.chartStatusMode === 'active'
        ? items.filter(x => !isItemCompleted(x))
        : items;

    // Filter items by current Gantt category tab
    const categoryItems = activeFiltered.filter(x => x.category === state.ganttCategory);

    // Group and sort items by planStart date (earliest first for a clean diagonal visual flow)
    // If no planStart/planEnd, fallback to createDate
    const ganttItems = categoryItems.map(item => {
        const planStart = item.planStart || item.createDate;
        const planEnd = item.planEnd || planStart;
        return {
            ...item,
            planStart,
            planEnd,
            originalItem: item
        };
    }).filter(x => x.planStart).sort((a, b) => {
        const dateA = new Date(a.planStart + ' 00:00:00').getTime();
        const dateB = new Date(b.planStart + ' 00:00:00').getTime();
        if (dateA !== dateB) return dateA - dateB;
        return a.id.localeCompare(b.id);
    });

    // 1. Generate column metadata based on ganttViewMode
    const cols = [];
    const start = new Date(state.ganttStartDate);
    let viewStart, viewEnd;
    
    if (state.ganttViewMode === 'day') {
        const numCols = 24;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            cols.push({
                date: d,
                label: d.getDate(),
                sublabel: (d.getMonth() + 1) + '月',
                isToday: isSameDay(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        viewEnd = cols[numCols - 1].date.getTime() + 86400000 - 1; // End of last day
    } else if (state.ganttViewMode === 'week') {
        const numCols = 12;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i * 7);
            cols.push({
                date: d,
                label: 'W' + getWeekNumber(d),
                sublabel: (d.getMonth() + 1) + '/' + d.getDate(),
                isToday: isCurrentWeek(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        viewEnd = cols[numCols - 1].date.getTime() + 7 * 86400000 - 1; // End of 12th week
    } else if (state.ganttViewMode === 'month') {
        const numCols = 6;
        for (let i = 0; i < numCols; i++) {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
            cols.push({
                date: d,
                label: (d.getMonth() + 1) + '月',
                sublabel: d.getFullYear(),
                isToday: isCurrentMonth(d, new Date())
            });
        }
        viewStart = cols[0].date.getTime();
        const lastColEnd = new Date(cols[numCols - 1].date.getFullYear(), cols[numCols - 1].date.getMonth() + 1, 1);
        viewEnd = lastColEnd.getTime() - 1; // End of 6th month
    }
    
    const viewDuration = viewEnd - viewStart;
    
    // Filter out gantt items that are completely outside the visible viewport window
    const visibleGanttItems = ganttItems.filter(item => {
        const itemStart = new Date(item.planStart + ' 00:00:00').getTime();
        const itemEnd = new Date((item.planEnd || item.planStart) + ' 23:59:59').getTime();
        return !(itemEnd < viewStart || itemStart > viewEnd);
    });

    // Clean container and create structure
    container.innerHTML = '';
    
    const layout = document.createElement('div');
    layout.className = 'gantt-layout';
    
    // Left Panel for Assignee info
    const leftPanel = document.createElement('div');
    leftPanel.className = 'gantt-left-panel';
    leftPanel.innerHTML = `<div class="gantt-header-cell">负责人</div>`;
    
    const assigneesList = document.createElement('div');
    assigneesList.className = 'gantt-assignees-list';
    
    // Right Panel for Timeline grid and bars
    const rightPanel = document.createElement('div');
    rightPanel.className = 'gantt-right-panel';
    
    const timelineHeader = document.createElement('div');
    timelineHeader.className = 'gantt-timeline-header';
    
    // Add grid columns to timeline header
    cols.forEach(col => {
        const colDiv = document.createElement('div');
        colDiv.className = 'gantt-col-header' + (col.isToday ? ' today' : '');
        colDiv.innerHTML = `
            <span class="day-num">${col.label}</span>
            <span class="month-lbl">${col.sublabel}</span>
        `;
        timelineHeader.appendChild(colDiv);
    });
    rightPanel.appendChild(timelineHeader);
    
    const timelineRows = document.createElement('div');
    timelineRows.className = 'gantt-timeline-rows';
    
    // Add columns background grid lines to timeline rows
    const gridBg = document.createElement('div');
    gridBg.className = 'gantt-grid-background';
    cols.forEach(col => {
        const colBg = document.createElement('div');
        colBg.className = 'gantt-grid-col' + (col.isToday ? ' today' : '');
        gridBg.appendChild(colBg);
    });
    timelineRows.appendChild(gridBg);
    
    // Add Today vertical line if visible in current view
    const nowTime = new Date().getTime();
    if (nowTime >= viewStart && nowTime <= viewEnd) {
        const todayLinePercent = ((nowTime - viewStart) / viewDuration) * 100;
        const todayLine = document.createElement('div');
        todayLine.className = 'gantt-today-line';
        todayLine.style.left = todayLinePercent + '%';
        timelineRows.appendChild(todayLine);
    }
    
    // Render Rows (Flat list: assignee row on left, timeline row on right)
    if (visibleGanttItems.length === 0) {
        const emptyRowLeft = document.createElement('div');
        emptyRowLeft.className = 'gantt-assignee-row';
        emptyRowLeft.innerHTML = `<span class="gantt-assignee-name" style="color: var(--text-muted);">暂无排期</span>`;
        assigneesList.appendChild(emptyRowLeft);
        
        const emptyRowRight = document.createElement('div');
        emptyRowRight.className = 'gantt-timeline-row';
        emptyRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 12px; color: var(--text-muted); z-index: 5;">当前时间窗口内无进行中任务计划</div>`;
        timelineRows.appendChild(emptyRowRight);
    } else {
        visibleGanttItems.forEach(item => {
            const assigneeName = item.assignee || '未指派';
            const initials = assigneeName.slice(0, 2);
            
            // 1. Create left panel assignee cell
            const assRow = document.createElement('div');
            assRow.className = 'gantt-assignee-row';
            assRow.innerHTML = `
                <div class="gantt-avatar">${initials}</div>
                <span class="gantt-assignee-name">${escapeHtml(assigneeName)}</span>
            `;
            // Trigger item modal detail on click
            assRow.addEventListener('click', () => showItemDetail(item.originalItem));
            assigneesList.appendChild(assRow);
            
            // 2. Create right panel timeline cell
            const timeRow = document.createElement('div');
            timeRow.className = 'gantt-timeline-row';
            
            // Parse item start/end dates
            const itemStart = new Date(item.planStart + ' 00:00:00').getTime();
            const itemEnd = new Date((item.planEnd || item.planStart) + ' 23:59:59').getTime();
            
            // Position percent math
            let left = ((itemStart - viewStart) / viewDuration) * 100;
            let width = ((itemEnd - itemStart) / viewDuration) * 100;
            
            // Clip to visible area boundaries for clean CSS layout
            let labelTextPrefix = '';
            if (left < 0) {
                width = width + left;
                left = 0;
                labelTextPrefix = '◀ ';
            }
            if (left + width > 100) {
                width = 100 - left;
                labelTextPrefix += '▶ ';
            }
            if (width < 1.2) width = 1.2;
            
            // Check if text overflows the Gantt bar based on estimated width
            const charCount = item.title.length + 25;
            const estimatedPxWidth = (width / 100) * 1000;
            const isTextOverflow = (charCount * 6.5) > estimatedPxWidth;
            
            const bar = document.createElement('div');
            bar.className = `gantt-bar category-${item.category}` + (isTextOverflow ? ' text-overflow' : '');
            bar.style.left = left + '%';
            bar.style.width = width + '%';
            
            const dateLabel = `${item.planStart.slice(5)}至${(item.planEnd || item.planStart).slice(5)}`;
            const typeLabel = item.workItemType ? `[${item.workItemType}]` : '';
            bar.innerHTML = `
                <span class="gantt-bar-text" title="${escapeHtml(item.title)} (${item.planStart} ~ ${item.planEnd})">
                    ${labelTextPrefix}${dateLabel} ${typeLabel} ${escapeHtml(item.title)}
                </span>
            `;
            
            bar.addEventListener('click', () => showItemDetail(item.originalItem));
            timeRow.appendChild(bar);
            timelineRows.appendChild(timeRow);
        });
    }
    
    leftPanel.appendChild(assigneesList);
    rightPanel.appendChild(timelineRows);
    
    layout.appendChild(leftPanel);
    layout.appendChild(rightPanel);
    container.appendChild(layout);
}
