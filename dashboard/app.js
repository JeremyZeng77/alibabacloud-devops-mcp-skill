// State Management
let state = {
    compiledAt: null,
    latest: { mftb: [], mfood: [] },
    history: { mftb: [], mfood: [] },
    weeklyReports: [],
    currentProject: 'mftb', // 'mftb' or 'mfood'
    currentView: 'overview', // 'overview', 'workitems', 'weekly', 'risk', 'config', 'audit'
    charts: {}, // Store Chart.js instances
    autoSyncIntervalId: null, // Store interval ID for 5 minutes sync
    chartStatusMode: 'active', // 'active' (进行中) or 'all' (全部)
    ganttViewMode: 'day', // 'day', 'week', or 'month'
    ganttStartDate: null,
    ganttCategory: 'Req', // 'Req', 'Task', or 'Bug'
    ganttExpandedAssignees: {},
    leadTimeKPI: { mftb: { average: 0, delta: 0 }, mfood: { average: 0, delta: 0 } },
    criticalPathConfig: null,
    pmoAdvice: {}
};


// Helper to check if an item is completed/delivered based on its category
function isItemCompleted(item) {
    const status = item.status || '';
    const cat = item.category || 'Req';
    const workItemType = item.workItemType || '';
    
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
            // For tasks where workItemType is '測試', testing statuses are NOT completed
            if (workItemType === '測試') {
                return false;
            }
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

// ── Business Line Classification ──
const DEFAULT_BUSINESS_LINE_CONFIG = {
    daojia: ['到家业务','到家業務','外卖','外賣','mFood','mfood','闪蜂','閃蜂','極馬','極馬專送','众包','眾包','专送','專送','配送','騎手','骑手','調度','调度','跑腿','外送','外賣業務'],
    daodian: ['團購','团购','到店','大係統','大系統','大系统','商家APP','商家 APP','商家端','商家app','门店','門店','商户','商戶','合同','推广金','推廣金','集團','集团','商家管理','商家入駐']
};

function loadBusinessLineConfig() {
    try {
        const saved = localStorage.getItem('devops_config_businessLine');
        if (saved) { const parsed = JSON.parse(saved); if (parsed.daojia && parsed.daodian) return parsed; }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_BUSINESS_LINE_CONFIG));
}

function saveBusinessLineConfig(config) {
    localStorage.setItem('devops_config_businessLine', JSON.stringify(config));
}

function getBusinessLine(item) {
    const config = loadBusinessLineConfig();
    const title = ((item.title || '') + ' ' + (item.rowText || '')).toLowerCase();
    for (const kw of config.daojia) { if (title.includes(kw.toLowerCase())) return 'daojia'; }
    for (const kw of config.daodian) { if (title.includes(kw.toLowerCase())) return 'daodian'; }
    return 'other';
}

const BRIDGE_API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
    ? `http://${window.location.hostname}:18790`
    : 'http://localhost:18790';

// Credentials Config
const AUTH_CONFIG = {
    username: 'jeremy',
    passwordHash: 'cd8e5d18ed10696006a2221b8796ff12e9b35da0b386341103db8d6030b134e2', // SHA-256 digest，不存明文凭证
    sessionExpiryHours: 4,      // 滑动超时：用户无操作达 4 小时后失效
    absoluteExpiryHours: 24     // 绝对超时：自登录起，连续登录达 24 小时后强制失效
};

// Check Session on Startup
function checkSession(refreshSliding = true) {
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

function clearSession() {
    localStorage.removeItem('devops_session_token');
    localStorage.removeItem('devops_session_timestamp');
    localStorage.removeItem('devops_session_login_time');
}

async function handleLoginSubmit() {
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
    
    // 使用 SHA-256 哈希校验密码，不存明文字段
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
    
    // Success
    const nowStr = Date.now().toString();
    localStorage.setItem('devops_session_token', 'devops-session-active');
    localStorage.setItem('devops_session_timestamp', nowStr);
    localStorage.setItem('devops_session_login_time', nowStr);
    
    // Fade out overlay
    const overlay = document.getElementById('login-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.display = 'none';
        document.getElementById('btn-logout').style.display = 'flex';
    }, 300);
    
    startDashboardApp();
}

function handleLogout() {
    clearSession();
    const overlay = document.getElementById('login-overlay');
    document.getElementById('btn-logout').style.display = 'none';
    
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error-msg').style.display = 'none';
    
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    
    // Reload page to clear all data in memory
    window.location.reload();
}

// 监听用户活跃事件以刷新滑动超时
function initSessionActivityListener() {
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

async function startDashboardApp() {
    initGanttState();
    initEventListeners();
    initSessionActivityListener(); // 绑定活跃状态刷新滑动过期
    initAutoSync();
    await loadDashboardData();
    
    // Auto polling every 60 seconds
    if (!state.pollingIntervalId) {
        state.pollingIntervalId = setInterval(pollDashboardData, 60000);
    }
}

// Initialize Page with Login Gatekeeper
document.addEventListener('DOMContentLoaded', async () => {
    const overlay = document.getElementById('login-overlay');
    const btnLogout = document.getElementById('btn-logout');
    
    // Bind login form submit
    const btnSubmit = document.getElementById('btn-login-submit');
    if (btnSubmit) {
        btnSubmit.addEventListener('click', handleLoginSubmit);
    }
    
    // Bind Enter key on inputs
    const loginFields = [document.getElementById('login-username'), document.getElementById('login-password')];
    loginFields.forEach(field => {
        if (field) {
            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleLoginSubmit();
            });
        }
    });
    
    // Bind logout action
    if (btnLogout) {
        btnLogout.addEventListener('click', handleLogout);
    }
    
    if (checkSession()) {
        overlay.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'flex';
        await startDashboardApp();
    } else {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
        if (btnLogout) btnLogout.style.display = 'none';
    }
});

// Event Listeners
function initEventListeners() {
    // Project Tabs (MFTB vs mFood)
    document.querySelectorAll('.project-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.currentProject = e.currentTarget.dataset.project;
            syncStateToURL();
            
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
            syncStateToURL();
            
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

    // Audit View Filters
    const auditSearch = document.getElementById('audit-search-input');
    if (auditSearch) {
        auditSearch.addEventListener('input', (e) => {
            auditFilters.search = e.target.value;
            renderAuditView();
        });
    }
    const auditRoleSelect = document.getElementById('audit-role-select');
    if (auditRoleSelect) {
        auditRoleSelect.addEventListener('change', (e) => {
            auditFilters.role = e.target.value;
            renderAuditView();
        });
    }
    const auditIgnoreReqCheckbox = document.getElementById('audit-ignore-req-checkbox');
    if (auditIgnoreReqCheckbox) {
        auditIgnoreReqCheckbox.addEventListener('change', (e) => {
            auditFilters.ignoreReq = e.target.checked;
            renderAuditView();
        });
    }

    // Filters event listeners
    ['filter-search', 'filter-category', 'filter-status', 'filter-assignee', 'filter-priority', 'filter-iteration', 'filter-business-line'].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            elem.addEventListener('input', () => {
                applyFilters();
                syncStateToURL();
            });
            elem.addEventListener('change', () => {
                applyFilters();
                syncStateToURL();
            });
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

    // Gantt role selector
    const ganttRoleSelect = document.getElementById('gantt-role-select');
    if (ganttRoleSelect) {
        ganttRoleSelect.addEventListener('change', () => {
            renderGanttChart();
        });
    }
    const ganttBizLineSelect = document.getElementById('gantt-bizline-select');
    if (ganttBizLineSelect) {
        ganttBizLineSelect.addEventListener('change', () => {
            renderGanttChart();
        });
    }

    // Close QA Mitigation Modal
    const btnCloseMitigation = document.getElementById('btn-close-mitigation');
    if (btnCloseMitigation) {
        btnCloseMitigation.addEventListener('click', hideQAMitigationModal);
    }
    const mitigationModal = document.getElementById('qa-mitigation-modal');
    if (mitigationModal) {
        mitigationModal.addEventListener('click', (e) => {
            if (e.target === mitigationModal) hideQAMitigationModal();
        });
    }

    // Export Markdown Snippet
    const btnExportMarkdown = document.getElementById('btn-export-markdown');
    if (btnExportMarkdown) {
        btnExportMarkdown.addEventListener('click', exportMarkdownSnippet);
    }

    // Gantt mobile landscape mode toggle
    const btnGanttLandscape = document.getElementById('btn-gantt-landscape');
    if (btnGanttLandscape) {
        btnGanttLandscape.addEventListener('click', () => {
            const ganttCard = document.querySelector('.gantt-chart-card');
            if (ganttCard) {
                const isLandscape = ganttCard.classList.toggle('landscape-fullscreen');
                const spanText = btnGanttLandscape.querySelector('span');
                if (spanText) {
                    spanText.textContent = isLandscape ? '返回竖屏' : '横屏查看';
                }
                // Dispatch resize event to recalculate widths
                window.dispatchEvent(new Event('resize'));
            }
        });
    }
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
async function loadCriticalPathConfig() {
    try {
        const response = await fetch('./critical_path_config.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Config file not found');
        const config = await response.json();
        state.criticalPathConfig = {
            keywords: Array.isArray(config.keywords) ? config.keywords : ["订单", "支付", "收银台", "消费金"],
            ids: Array.isArray(config.ids) ? config.ids : []
        };
    } catch (err) {
        console.warn('Failed to load critical path config, using defaults:', err);
        state.criticalPathConfig = {
            keywords: ["订单", "支付", "收银台", "消费金"],
            ids: []
        };
    }
}

function isCriticalPath(item) {
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

function syncStateToURL() {
    const params = new URLSearchParams();
    params.set('project', state.currentProject);
    params.set('view', state.currentView);
    
    if (state.currentView === 'workitems') {
        const searchVal = document.getElementById('filter-search').value.trim();
        const categoryVal = document.getElementById('filter-category').value;
        const statusVal = document.getElementById('filter-status').value;
        const assigneeVal = document.getElementById('filter-assignee').value;
        const priorityVal = document.getElementById('filter-priority').value;
        const iterationVal = document.getElementById('filter-iteration').value;
        
        if (searchVal) params.set('search', searchVal);
        if (categoryVal !== 'Req') params.set('category', categoryVal);
        if (statusVal !== 'all') params.set('status', statusVal);
        if (assigneeVal !== 'all') params.set('assignee', assigneeVal);
        if (priorityVal !== 'all') params.set('priority', priorityVal);
        if (iterationVal !== 'all') params.set('iteration', iterationVal);
        const bizVal = document.getElementById('filter-business-line').value;
        if (bizVal !== 'all') params.set('bizline', bizVal);
    }
    
    const newURL = window.location.pathname + '?' + params.toString();
    window.history.replaceState(null, '', newURL);
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('project')) {
        const proj = params.get('project');
        if (proj === 'mftb' || proj === 'mfood') {
            state.currentProject = proj;
        }
    }
    if (params.has('view')) {
        const view = params.get('view');
        if (['overview', 'workitems', 'weekly', 'risk', 'config', 'audit'].includes(view)) {
            state.currentView = view;
        }
    }
    
    // Sync UI elements to values
    document.querySelectorAll('.project-tab').forEach(t => {
        if (t.dataset.project === state.currentProject) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.nav-tab').forEach(t => {
        if (t.dataset.view === state.currentView) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const viewEl = document.getElementById(`view-${state.currentView}`);
    if (viewEl) viewEl.classList.add('active');
    
    // Read and store parameters into temp state to be applied when filters populate
    state.urlFilters = {
        search: params.get('search') || null,
        category: params.get('category') || null,
        status: params.get('status') || null,
        assignee: params.get('assignee') || null,
        priority: params.get('priority') || null,
        iteration: params.get('iteration') || null,
        bizline: params.get('bizline') || null
    };
}

// 动态统计各角色下的人员数量，并更新下拉框选项文本（例如：服务端 (14人)）
function updateRoleSelectsWithCounts() {
    const roleCounts = {
        Backend: 0,
        Frontend: 0,
        Mobile: 0,
        UI: 0,
        Ops: 0,
        Product: 0,
        PM: 0,
        Tester: 0
    };
    
    Object.values(DEVELOPER_ROLES_MAP).forEach(role => {
        if (roleCounts[role] !== undefined) {
            roleCounts[role]++;
        }
    });
    
    const totalCount = Object.values(roleCounts).reduce((sum, val) => sum + val, 0);
    
    const ganttLabels = {
        all: `全角色 (${totalCount}人)`,
        Backend: `服务端 (${roleCounts.Backend}人)`,
        Frontend: `前端开发 (${roleCounts.Frontend}人)`,
        Mobile: `移动开发 (${roleCounts.Mobile}人)`,
        Tester: `测试 (${roleCounts.Tester}人)`,
        Product: `产品 (${roleCounts.Product}人)`,
        UI: `UI设计 (${roleCounts.UI}人)`,
        PM: `项目经理 (${roleCounts.PM}人)`,
        Ops: `运维 (${roleCounts.Ops}人)`
    };

    const auditLabels = {
        all: `全部角色 (${totalCount}人)`,
        Backend: `服务端 (${roleCounts.Backend}人)`,
        Frontend: `前端 (${roleCounts.Frontend}人)`,
        Mobile: `移动端 (${roleCounts.Mobile}人)`,
        Tester: `测试 (${roleCounts.Tester}人)`,
        Product: `产品 (${roleCounts.Product}人)`,
        UI: `UI设计 (${roleCounts.UI}人)`,
        PM: `项目经理 (${roleCounts.PM}人)`,
        Ops: `运维 (${roleCounts.Ops}人)`
    };
    
    const selectGantt = document.getElementById('gantt-role-select');
    if (selectGantt) {
        Array.from(selectGantt.options).forEach(opt => {
            const val = opt.value;
            if (ganttLabels[val]) {
                opt.textContent = ganttLabels[val];
            }
        });
    }

    const selectAudit = document.getElementById('audit-role-select');
    if (selectAudit) {
        Array.from(selectAudit.options).forEach(opt => {
            const val = opt.value;
            if (auditLabels[val]) {
                opt.textContent = auditLabels[val];
            }
        });
    }
}

async function loadDashboardData() {
    try {
        await loadCriticalPathConfig();
        loadStateFromURL();
        updateRoleSelectsWithCounts(); // 初始化更新筛选下拉框人数
        
        const response = await fetch('./projects_data.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Data file not found');
        const db = await response.json();
        
        // Update state
        state.compiledAt = db.compiledAt;
        state.latest = db.latest;
        state.history = db.history;
        state.weeklyReports = db.weeklyReports || [];
        state.leadTimeKPI = db.leadTimeKPI || { mftb: { average: 0, delta: 0 }, mfood: { average: 0, delta: 0 } };
        state.pmoAdvice = db.pmoAdvice || {};

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
    // 后台静默轮询时进行只读检测，如超时则强制登出
    if (!checkSession(false)) {
        handleLogout();
        return;
    }
    
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
            state.leadTimeKPI = db.leadTimeKPI || { mftb: { average: 0, delta: 0 }, mfood: { average: 0, delta: 0 } };
            state.pmoAdvice = db.pmoAdvice || {};
            
            updateTimestamps();
            renderCurrentView();
            showToast('已自动同步最新数据。');
        }
    } catch (err) {
        // Silent fail for background poll
    }
}

// Trigger recompile on bridge server or GitHub Actions (if online)
async function triggerSyncCompile() {
    const btn = document.getElementById('btn-sync-compile');
    btn.classList.add('spinning');

    // Cloud workflow dispatch if online (not local)
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' || 
                    window.location.hostname.startsWith('192.168.');

    if (!isLocal) {
        let vercelUrl = localStorage.getItem('vercel_sync_url') || 'https://alibabacloud-devops-mcp-skill.vercel.app/api/sync';
        let pat = localStorage.getItem('github_pat') || '';

        // 1. Try to trigger via Vercel first if configured
        if (!pat && vercelUrl) {
            showToast('正在通过云端免密服务触发同步...');
            try {
                const response = await fetch(vercelUrl, { method: 'POST' });
                const data = await response.json();
                if (response.ok && data.ok) {
                    showToast('已成功通过云端免密服务触发同步构建！更新大约需要 15 秒，请稍后刷新。');
                    btn.classList.remove('spinning');
                    return;
                } else {
                    console.warn('Vercel sync proxy failed:', data.error);
                }
            } catch (err) {
                console.warn('Vercel sync proxy network error, falling back to PAT prompt.');
            }
        }

        // 2. Fallback to PAT / URL prompt
        if (!pat) {
            const input = prompt('请输入您的 GitHub 个人访问令牌 (PAT) 以便在线上直接触发同步编译（若已配置 Vercel 免费中转服务，请直接粘贴您的 Vercel URL 接口以开启免密同步）：');
            if (!input) {
                btn.classList.remove('spinning');
                showToast('已取消同步。');
                return;
            }

            const trimmed = input.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                localStorage.setItem('vercel_sync_url', trimmed);
                // Retry compilation immediately using the newly configured Vercel URL
                btn.classList.remove('spinning');
                triggerSyncCompile();
                return;
            } else {
                pat = trimmed;
                localStorage.setItem('github_pat', pat);
            }
        }

        // 3. Direct GitHub Actions API trigger (using PAT)
        showToast('正在向 GitHub API 发送构建指令...');
        try {
            const url = 'https://api.github.com/repos/JeremyZeng77/alibabacloud-devops-mcp-skill/actions/workflows/sync-data.yml/dispatches';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${pat}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ref: 'main' })
            });

            if (response.status === 204) {
                showToast('已成功在云端触发同步构建！更新大约需要 15 秒，请稍后刷新。');
                btn.classList.remove('spinning');
            } else {
                const errText = await response.text();
                console.error('Trigger cloud sync failed:', response.status, errText);
                if (response.status === 401 || response.status === 403) {
                    showToast('令牌无效或权限不足，已清除保存的令牌，请重试！');
                    localStorage.removeItem('github_pat');
                } else {
                    showToast(`触发云端同步失败 (${response.status})，请检查设置。`);
                }
                btn.classList.remove('spinning');
            }
        } catch (err) {
            console.error('Cloud sync failed:', err);
            showToast('无法连接到 GitHub API，请检查您的网络连接！');
            btn.classList.remove('spinning');
        }
        return;
    }

    // Local compiler flow
    showToast('正在向本地桥接服务发送编译指令...');
    try {
        const response = await fetch(`${BRIDGE_API_BASE}/compile`, { method: 'GET' });
        const res = await response.json();

        if (response.ok && res.ok) {
            showToast('编译成功！正在加载最新看板数据...');
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

    // Collected time (derived from compiledAt, since data is fetched during compile)
    if (state.compiledAt) {
        const date = new Date(state.compiledAt);
        const pad = (n) => n.toString().padStart(2, '0');
        document.getElementById('time-collected').textContent = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    } else if (state.currentView === 'audit') {
        renderAuditView();
    } else if (state.currentView === 'risk') {
        renderRiskCenter();
    } else if (state.currentView === 'config') {
        renderConfigCenter();
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

    // Business Line KPI
    const bizDaojia = items.filter(x => getBusinessLine(x) === 'daojia');
    const bizDaodian = items.filter(x => getBusinessLine(x) === 'daodian');
    const D = x => isItemCompleted(x) ? 0 : 1;
    document.getElementById('kpi-daojia-total').textContent = bizDaojia.length;
    document.getElementById('kpi-daojia-active').textContent = bizDaojia.reduce((acc, x) => acc + D(x), 0);
    document.getElementById('kpi-daodian-total').textContent = bizDaodian.length;
    document.getElementById('kpi-daodian-active').textContent = bizDaodian.reduce((acc, x) => acc + D(x), 0);

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

    // Render Lead Time KPI
    const kpiLeadTime = state.leadTimeKPI[state.currentProject] || { average: 0, delta: 0 };
    const avgVal = parseFloat(kpiLeadTime.average) || 0.0;
    const deltaVal = parseFloat(kpiLeadTime.delta) || 0.0;
    document.getElementById('kpi-lead-time-value').textContent = `${avgVal.toFixed(1)} 天`;
    setTrendText('kpi-lead-time-trend', deltaVal, '天', true, false);

    // Render Charts & Risk Radar
    renderHistoryChart(history);
    renderStatusChart(items);
    renderTypeChart(items);
    renderWorkloadChart(items);
    renderGanttChart();
    renderRiskRadar(items);
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
    
    // Apply search and category from URL if they exist on initial load
    if (state.urlFilters) {
        if (state.urlFilters.search !== null) {
            const searchEl = document.getElementById('filter-search');
            if (searchEl) searchEl.value = state.urlFilters.search;
        }
        if (state.urlFilters.category !== null) {
            const catEl = document.getElementById('filter-category');
            if (catEl) catEl.value = state.urlFilters.category;
        }
    }
    
    const categoryVal = document.getElementById('filter-category').value;
    
    // Filter items based on selected category to make dropdown options relevant
    const items = categoryVal === 'all' ? allItems : allItems.filter(x => x.category === categoryVal);
    
    // Status
    const statusSelect = document.getElementById('filter-status');
    let prevStatus = statusSelect.value;
    if (state.urlFilters && state.urlFilters.status !== null) {
        prevStatus = state.urlFilters.status;
    }
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
    let prevAss = assSelect.value;
    if (state.urlFilters && state.urlFilters.assignee !== null) {
        prevAss = state.urlFilters.assignee;
    }
    assSelect.innerHTML = '<option value="all">全部负责人</option>';
    const assignees = [...new Set(items.map(x => x.assignee))].filter(Boolean);
    assignees.forEach(ass => {
        const opt = document.createElement('option');
        opt.value = ass;
        opt.textContent = ass;
        assSelect.appendChild(opt);
    });
    assSelect.value = prevAss && assignees.includes(prevAss) ? prevAss : 'all';

    // Priority
    if (state.urlFilters && state.urlFilters.priority !== null) {
        const prioSelect = document.getElementById('filter-priority');
        if (prioSelect) prioSelect.value = state.urlFilters.priority;
    }

    // Iteration
    const iterSelect = document.getElementById('filter-iteration');
    let prevIter = iterSelect.value;
    if (state.urlFilters && state.urlFilters.iteration !== null) {
        prevIter = state.urlFilters.iteration;
    }
    iterSelect.innerHTML = '<option value="all">全部迭代</option>';
    const iterations = [...new Set(items.map(x => x.iteration))].filter(Boolean);
    iterations.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it;
        opt.textContent = it;
        iterSelect.appendChild(opt);
    });
    iterSelect.value = prevIter && iterations.includes(prevIter) ? prevIter : 'all';
    
    // Restore business line from URL
    const bizSelect = document.getElementById('filter-business-line');
    if (bizSelect && state.urlFilters && state.urlFilters.bizline !== null) {
        bizSelect.value = state.urlFilters.bizline;
    }
    
    // Clear URL filters so subsequent user actions are not locked
    state.urlFilters = null;
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
    const bizVal = document.getElementById('filter-business-line') ? document.getElementById('filter-business-line').value : 'all';

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
        // Business Line
        if (bizVal !== 'all' && getBusinessLine(x) !== bizVal) return false;

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

        let bizBadge = '';
        const biz = getBusinessLine(item);
        if (biz === 'daojia') bizBadge = '<span class="badge-biz badge-biz-daojia">🏠 到家</span>';
        else if (biz === 'daodian') bizBadge = '<span class="badge-biz badge-biz-daodian">🏪 到店</span>';

        tr.innerHTML = `
            <td class="cell-id" style="font-family: monospace; color: var(--color-primary);">${item.id || fallbackPrefix + (index + 1)}</td>
            <td class="cell-title">
                ${item.category === 'Req' ? '<span class="badge-cat badge-cat-req">💭 需求</span>' : 
                  item.category === 'Task' ? '<span class="badge-cat badge-cat-task">💡 任务</span>' : 
                  item.category === 'Bug' ? '<span class="badge-cat badge-cat-bug">🚨 缺陷</span>' : ''}
                ${bizBadge}
                ${escapeHtml(item.title)}
            </td>
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
    const projKey = state.currentProject; // 'mftb' or 'mfood'

    // 渲染 PMO 项目管理总监专业建议
    const pmoAdviceContainer = document.getElementById('weekly-pmo-advice-container');
    if (pmoAdviceContainer) {
        const advice = (state.pmoAdvice && state.pmoAdvice[projKey]) ? state.pmoAdvice[projKey] : null;
        if (advice && advice.content && advice.content.trim()) {
            pmoAdviceContainer.style.display = 'block';
            pmoAdviceContainer.innerHTML = `
                <div class="pmo-advice-header">
                    <div class="pmo-advice-title-group">
                        <span class="pmo-advice-icon">💡</span>
                        <h3 class="pmo-advice-title">项目管理建议</h3>
                    </div>
                    <span class="pmo-advice-meta">更新时间：${advice.updatedAt || '刚刚'}</span>
                </div>
                <div class="pmo-advice-content">
                    ${parseNarrativeMarkdown(advice.content)}
                </div>
            `;
        } else {
            pmoAdviceContainer.style.display = 'block';
            pmoAdviceContainer.innerHTML = `
                <div class="pmo-advice-header">
                    <div class="pmo-advice-title-group">
                        <span class="pmo-advice-icon">💡</span>
                        <h3 class="pmo-advice-title">项目管理建议</h3>
                    </div>
                    <span class="pmo-advice-meta">尚未更新</span>
                </div>
                <div class="pmo-advice-empty">
                    暂无今日项目管理建议。系统将在每日 11:30 和 17:30 自动生成并推送最新大盘建议。
                </div>
            `;
        }
    }

    const report = state.weeklyReports.find(r => r.week === weekVal);
    if (!report) {
        ['weekly-progress', 'weekly-planning', 'weekly-assessment', 'weekly-risks', 'weekly-recommendations'].forEach(id => {
            document.getElementById(id).innerHTML = `<div style="color: var(--text-muted)">本周周期暂未编制文字周报</div>`;
        });
        document.getElementById('weekly-metrics-card').style.display = 'none';
        return;
    }

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
    
    // Render Technical Management Action Items
    const recContent = document.getElementById('weekly-recommendations');
    const actionItems = projReport.actionItems || [];
    
    if (actionItems.length > 0) {
        // Calculate AICR (Action Item Closure Rate)
        const completed = actionItems.filter(x => x.completed).length;
        const total = actionItems.length;
        const aicr = total > 0 ? (completed / total * 100) : 0;
        
        // Inject/Update AICR badge in the card header
        const recHeader = document.querySelector('.card-badge-purple');
        if (recHeader) {
            let aicrBadge = recHeader.querySelector('.aicr-badge');
            if (!aicrBadge) {
                aicrBadge = document.createElement('span');
                aicrBadge.className = 'aicr-badge';
                recHeader.appendChild(aicrBadge);
            }
            aicrBadge.style.cssText = 'margin-left: auto; font-size: 13.5px; font-weight: 600; color: var(--color-primary); background: rgba(0, 242, 254, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(0, 242, 254, 0.2);';
            aicrBadge.textContent = `建议落实率 (AICR): ${aicr.toFixed(1)}%`;
            
            recHeader.style.display = 'flex';
            recHeader.style.alignItems = 'center';
            recHeader.style.width = '100%';
        }
        
        // Build Action Items Table
        let tableHTML = `
            <table class="weekly-data-table" style="margin-top: 16px;">
                <thead>
                    <tr>
                        <th>建议项 (Action Item)</th>
                        <th style="width: 100px;">负责人</th>
                        <th style="width: 120px;">截止日期</th>
                        <th style="width: 110px;">状态/警报</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        const nowTime = new Date('2026-06-08T00:00:00').getTime();
        
        actionItems.forEach(item => {
            let statusBadge = '';
            if (item.completed) {
                statusBadge = '<span class="badge badge-status-completed">已完成</span>';
            } else {
                const dueTime = new Date(item.due + 'T00:00:00').getTime();
                const diffMs = dueTime - nowTime;
                const diffHours = diffMs / (1000 * 60 * 60);
                
                if (diffMs < 0) {
                    statusBadge = '<span class="badge badge-status-overdue">已超期</span>';
                } else if (diffHours <= 48) {
                    statusBadge = '<span class="badge badge-status-warn">即将超期</span>';
                } else {
                    statusBadge = '<span class="badge badge-status-progress">进行中</span>';
                }
            }
            
            tableHTML += `
                <tr>
                    <td style="font-weight: 500; color: var(--text-primary);">${escapeHtml(item.desc)}</td>
                    <td style="color: var(--text-secondary);">${escapeHtml(item.owner)}</td>
                    <td style="color: var(--text-muted); font-family: monospace;">${item.due}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });
        
        tableHTML += `
                </tbody>
            </table>
        `;
        
        recContent.innerHTML = tableHTML;
    } else {
        // Fallback: hide AICR badge and render raw recommendations text
        const recHeader = document.querySelector('.card-badge-purple');
        if (recHeader) {
            const aicrBadge = recHeader.querySelector('.aicr-badge');
            if (aicrBadge) aicrBadge.remove();
        }
        recContent.innerHTML = parseNarrativeMarkdown(projReport.recommendations);
    }
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
    // Replace **bold** with <strong>bold</strong>
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// Show Drill-down Modal
function showItemDetail(item) {
    const categoryName = item.category === 'Req' ? '需求' : (item.category === 'Task' ? '任务' : (item.category === 'Bug' ? '缺陷' : '工作项'));
    document.getElementById('modal-item-id').textContent = `${categoryName}详情 - ${item.id}`;
    
    const catBadge = item.category === 'Req' ? '<span class="badge-cat badge-cat-req">💭 需求</span>' : 
                     item.category === 'Task' ? '<span class="badge-cat badge-cat-task">💡 任务</span>' : 
                     item.category === 'Bug' ? '<span class="badge-cat badge-cat-bug">🚨 缺陷</span>' : '';
    document.getElementById('modal-item-title').innerHTML = `${catBadge} ${escapeHtml(item.title)}`;
    
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
        // Start date is 4 days before today
        const start = new Date(today);
        start.setDate(today.getDate() - 4);
        state.ganttStartDate = start;
    } else if (mode === 'week') {
        // Start date is 2 weeks before the current week (aligned to Monday)
        const start = new Date(today);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Align to Monday
        const monday = new Date(start.setDate(diff));
        monday.setDate(monday.getDate() - 14); // 2 weeks back
        state.ganttStartDate = monday;
    } else if (mode === 'month') {
        // Start date is 1 month before current month
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        state.ganttStartDate = start;
    }
}

// Shift timeline window by direction
function shiftGanttTimeline(direction) {
    const start = new Date(state.ganttStartDate);
    if (state.ganttViewMode === 'day') {
        // Shift by 7 days
        start.setDate(start.getDate() + direction * 7);
    } else if (state.ganttViewMode === 'week') {
        // Shift by 4 weeks
        start.setDate(start.getDate() + direction * 28);
    } else if (state.ganttViewMode === 'month') {
        // Shift by 2 months
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

const milestonesConfig = {
    mftb: [
        { name: "MFTB Beta Release", date: "2026-06-12" },
        { name: "MFTB V1.0.0 Online", date: "2026-06-15" }
    ],
    mfood: [
        { name: "mFood V7.2.0 Launch", date: "2026-05-29" },
        { name: "mFood V7.2.5 Launch", date: "2026-06-15" }
    ]
};

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

    // Filter by selected Gantt role if set
    const roleSelect = document.getElementById('gantt-role-select');
    const selectedRole = roleSelect ? roleSelect.value : 'all';
    
    const roleFiltered = selectedRole === 'all'
        ? categoryItems
        : categoryItems.filter(item => inferDeveloperRole(item.assignee, items) === selectedRole);

    // Filter by Gantt business line
    const ganttBizSelect = document.getElementById('gantt-bizline-select');
    const ganttBizLine = ganttBizSelect ? ganttBizSelect.value : 'all';
    const bizFiltered = ganttBizLine === 'all'
        ? roleFiltered
        : roleFiltered.filter(item => getBusinessLine(item) === ganttBizLine);

    // Map and calculate plan dates
    const ganttItems = bizFiltered.map(item => {
        const planStart = item.planStart || item.createDate;
        const planEnd = item.planEnd || planStart;
        return {
            ...item,
            planStart,
            planEnd,
            originalItem: item
        };
    }).filter(x => x.planStart);

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

    // Render Milestone vertical release lines
    const milestones = milestonesConfig[state.currentProject] || [];
    milestones.forEach(m => {
        const tMilestone = new Date(m.date + ' 00:00:00').getTime();
        if (tMilestone >= viewStart && tMilestone <= viewEnd) {
            const leftPercent = ((tMilestone - viewStart) / viewDuration) * 100;
            const releaseLine = document.createElement('div');
            releaseLine.className = 'gantt-release-line';
            releaseLine.style.left = leftPercent + '%';
            releaseLine.innerHTML = `
                <div class="release-line-marker"></div>
                <div class="release-tooltip">
                    <span class="milestone-name" style="font-weight: 600; color: #fff;">${escapeHtml(m.name)}</span>
                    <span class="milestone-date" style="color: var(--color-primary);">${m.date}</span>
                </div>
            `;
            timelineRows.appendChild(releaseLine);
        }
    });
    
    // Group visible items by Assignee
    const groups = {};
    visibleGanttItems.forEach(item => {
        const name = item.assignee || '未指派';
        groups[name] = groups[name] || [];
        groups[name].push(item);
    });

    const activeAssignees = Object.keys(groups).sort();
    const idleAssignees = [];
    for (const [name, role] of Object.entries(DEVELOPER_ROLES_MAP)) {
        if (selectedRole === 'all' || role === selectedRole) {
            if (!groups[name]) {
                idleAssignees.push(name);
            }
        }
    }
    idleAssignees.sort();

    const assigneeNames = [...activeAssignees, ...idleAssignees];
    
    if (assigneeNames.length === 0) {
        // Render a placeholder row if empty
        const emptyRowLeft = document.createElement('div');
        emptyRowLeft.className = 'gantt-assignee-row';
        emptyRowLeft.innerHTML = `<span class="gantt-assignee-name" style="color: var(--text-muted);">暂无排期</span>`;
        assigneesList.appendChild(emptyRowLeft);
        
        const emptyRowRight = document.createElement('div');
        emptyRowRight.className = 'gantt-timeline-row';
        emptyRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 12px; color: var(--text-muted); z-index: 5;">当前时间窗口内无进行中任务计划</div>`;
        timelineRows.appendChild(emptyRowRight);
    } else {
        assigneeNames.forEach(name => {
            const assigneeItems = groups[name] || [];
            
            if (assigneeItems.length === 0) {
                // Render idle member row (no lanes, no expansion)
                const headerRowLeft = document.createElement('div');
                headerRowLeft.className = 'gantt-assignee-row';
                headerRowLeft.style.background = 'rgba(255, 255, 255, 0.01)';
                headerRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
                headerRowLeft.innerHTML = `
                    <span style="font-size: 10px; color: var(--text-muted); margin-right: 4px; visibility: hidden;">▶</span>
                    <div class="gantt-avatar" style="opacity: 0.5; background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); color: var(--text-muted);">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
                    <span class="gantt-assignee-name" style="font-weight: 500; color: var(--text-muted);">${escapeHtml(name)} <span style="color: var(--text-muted); font-size: 11px;">(0项)</span></span>
                `;
                assigneesList.appendChild(headerRowLeft);
                
                const headerRowRight = document.createElement('div');
                headerRowRight.className = 'gantt-timeline-row';
                headerRowRight.style.background = 'rgba(255, 255, 255, 0.01)';
                headerRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
                headerRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 11px; color: var(--text-muted); z-index: 5; font-style: italic;">暂无分配工作项 (闲置)</div>`;
                timelineRows.appendChild(headerRowRight);
                
                return;
            }
            
            // Sort assigneeItems stably: planStart (asc) -> planEnd (asc) -> workitem_id (asc)
            assigneeItems.sort((a, b) => {
                const sA = new Date(a.planStart + ' 00:00:00').getTime();
                const sB = new Date(b.planStart + ' 00:00:00').getTime();
                if (sA !== sB) return sA - sB;
                
                const eA = new Date((a.planEnd || a.planStart) + ' 23:59:59').getTime();
                const eB = new Date((b.planEnd || b.planStart) + ' 23:59:59').getTime();
                if (eA !== eB) return eA - eB;
                
                return a.id.localeCompare(b.id);
            });
            
            // Greedy lane allocation
            const lanes = [];
            const overlaps = (item1, item2) => {
                const s1 = new Date(item1.planStart + ' 00:00:00').getTime();
                const e1 = new Date((item1.planEnd || item1.planStart) + ' 23:59:59').getTime();
                const s2 = new Date(item2.planStart + ' 00:00:00').getTime();
                const e2 = new Date((item2.planEnd || item2.planStart) + ' 23:59:59').getTime();
                return s1 <= e2 && s2 <= e1;
            };
            
            assigneeItems.forEach(item => {
                let allocated = false;
                for (let i = 0; i < lanes.length; i++) {
                    const lane = lanes[i];
                    if (!lane.some(laneItem => overlaps(laneItem, item))) {
                        lane.push(item);
                        allocated = true;
                        break;
                    }
                }
                if (!allocated) {
                    lanes.push([item]);
                }
            });
            
            const isExpanded = state.ganttExpandedAssignees[name] !== false;
            
            // Accordion Header Row
            const headerRowLeft = document.createElement('div');
            headerRowLeft.className = 'gantt-assignee-row';
            headerRowLeft.style.cursor = 'pointer';
            headerRowLeft.style.background = 'rgba(255, 255, 255, 0.02)';
            headerRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';
            headerRowLeft.innerHTML = `
                <span style="font-size: 10px; color: var(--color-primary); margin-right: 4px;">${isExpanded ? '▼' : '▶'}</span>
                <div class="gantt-avatar">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
                <span class="gantt-assignee-name" style="font-weight: 600;">${escapeHtml(name)} <span style="color: var(--text-muted); font-size: 11px;">(${assigneeItems.length}项)</span></span>
            `;
            headerRowLeft.addEventListener('click', () => {
                state.ganttExpandedAssignees[name] = !isExpanded;
                renderGanttChart();
            });
            assigneesList.appendChild(headerRowLeft);
            
            const headerRowRight = document.createElement('div');
            headerRowRight.className = 'gantt-timeline-row';
            headerRowRight.style.cursor = 'pointer';
            headerRowRight.style.background = 'rgba(255, 255, 255, 0.02)';
            headerRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';
            headerRowRight.innerHTML = `<div style="padding-left: 20px; font-size: 11.5px; color: var(--text-muted); z-index: 5;">点击展开/收起排期明细</div>`;
            headerRowRight.addEventListener('click', () => {
                state.ganttExpandedAssignees[name] = !isExpanded;
                renderGanttChart();
            });
            timelineRows.appendChild(headerRowRight);
            
            if (isExpanded) {
                lanes.forEach((laneItems, laneIndex) => {
                    const laneRowLeft = document.createElement('div');
                    laneRowLeft.className = 'gantt-assignee-row';
                    laneRowLeft.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
                    laneRowLeft.style.paddingLeft = '32px';
                    laneRowLeft.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">└ Lane ${laneIndex + 1}</span>`;
                    assigneesList.appendChild(laneRowLeft);
                    
                    const laneRowRight = document.createElement('div');
                    laneRowRight.className = 'gantt-timeline-row';
                    laneRowRight.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
                    
                    laneItems.forEach(item => {
                        const itemStart = new Date(item.planStart + ' 00:00:00').getTime();
                        const itemEnd = new Date((item.planEnd || item.planStart) + ' 23:59:59').getTime();
                        
                        const drawStart = Math.max(itemStart, viewStart);
                        const drawEnd = Math.min(itemEnd, viewEnd);
                        
                        const left = ((drawStart - viewStart) / viewDuration) * 100;
                        let width = ((drawEnd - drawStart) / viewDuration) * 100;
                        if (width < 1.2) width = 1.2;
                        
                        const charCount = item.title.length + 25;
                        const estimatedPxWidth = (width / 100) * 1000;
                        const isTextOverflow = (charCount * 6.5) > estimatedPxWidth;
                        
                        const bar = document.createElement('div');
                        bar.className = `gantt-bar category-${item.category}` + (isTextOverflow ? ' text-overflow' : '');
                        bar.style.left = left + '%';
                        bar.style.width = width + '%';
                        
                        let labelTextPrefix = '';
                        if (isItemCompleted(item)) {
                            labelTextPrefix += '✓ ';
                        } else {
                            labelTextPrefix += '▶ ';
                        }
                        
                        const dateLabel = `${item.planStart.slice(5)}至${(item.planEnd || item.planStart).slice(5)}`;
                        const typeLabel = item.workItemType ? `[${item.workItemType}]` : '';
                        bar.innerHTML = `
                            <span class="gantt-bar-text" title="${escapeHtml(item.title)} (${item.planStart} ~ ${item.planEnd})">
                                ${labelTextPrefix}${dateLabel} ${typeLabel} ${escapeHtml(item.title)}
                            </span>
                        `;
                        
                        bar.addEventListener('click', () => showItemDetail(item.originalItem));
                        laneRowRight.appendChild(bar);
                    });
                    
                    timelineRows.appendChild(laneRowRight);
                });
            }
        });
    }
    
    leftPanel.appendChild(assigneesList);
    rightPanel.appendChild(timelineRows);
    
    layout.appendChild(leftPanel);
    layout.appendChild(rightPanel);
    container.appendChild(layout);
}

// ============================================================================
// QA Bottleneck Risk Radar & Mitigation Advising
// ============================================================================

// ============================================================================
// Developer Sub-role Classifier & Strategic Advising Heuristics
// ============================================================================

const roleMeta = {
    Frontend: { name: '前端开发', badge: 'badge-role-fe' },
    Backend: { name: '后端开发', badge: 'badge-role-be' },
    Mobile: { name: '移动开发', badge: 'badge-role-mobile' },
    UI: { name: 'UI设计', badge: 'badge-role-ui' },
    Ops: { name: '运维工程师', badge: 'badge-role-ops' },
    Product: { name: '产品经理', badge: 'badge-role-other' },
    PM: { name: '项目经理', badge: 'badge-role-other' },
    Tester: { name: '测试工程师', badge: 'badge-role-other' },
    Fullstack: { name: '全栈开发', badge: 'badge-role-fullstack' }
};

const DEVELOPER_ROLES_MAP = {
    "曾庆超": "PM",
    "李古悦": "PM",
    "李政宏": "Backend",
    "黄信杰": "Backend",
    "刘志敏": "Backend",
    "黎月平": "Backend",
    "刘付益": "Backend",
    "林泽斌": "Backend",
    "张健伟": "Backend",
    "唐光伟": "Backend",
    "卓坚": "Backend",
    "杨至成": "Backend",
    "龚凯": "Backend",
    "刘卫": "Backend",
    "朱敬辉": "Backend",
    "叶龙": "Backend",
    "李科": "Frontend",
    "甄荣康": "Frontend",
    "陈文涛": "Frontend",
    "洪喜彬": "Frontend",
    "周忠浩": "Frontend",
    "许强": "Frontend",
    "陈剑": "Mobile",
    "徐子旺": "Mobile",
    "郑跃浩": "Mobile",
    "卓天鸿": "Mobile",
    "陈少丹": "Mobile",
    "梁富城": "Mobile",
    "陈万里": "Mobile",
    "陈国伟": "Mobile",
    "杨庆龙": "Tester",
    "曹晴晴": "Tester",
    "黄春晓": "Tester",
    "侯黎明": "Tester",
    "冼嘉业": "Tester",
    "李云锋": "Tester",
    "黄金凤": "Tester",
    "贺志成": "Tester",
    "朱家萱": "Tester",
    "练俊文": "Ops",
    "杨磊": "Ops",
    "廖荣": "Product",
    "覃林方": "Product",
    "刘龙振海": "Product",
    "冯松": "Product",
    "温浩源": "Product",
    "溫浩源": "Product",
    "周昱强": "Product",
    "赵嘉颖": "Product",
    "龙颖之": "Product",
    "胡家兴": "UI",
    "许思浩": "UI",
    "罗安琪": "UI",
    "李玉玲": "UI",
    "李鑫": "UI"
};

function inferDeveloperRole(devName, allItems) {
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

function getStrategicAdvices(items) {
    const activeTasks = items.filter(x => x.category === 'Task');
    const numeratorList = activeTasks.filter(x => {
        if (!['提交测试', '待测试', '已提测', '发包已测试'].includes(x.status)) return false;
        if (x.status === '提交测试' && x.workItemType !== '測試') return false;
        return true;
    });
    const denominatorList = activeTasks.filter(x => {
        if (!['测试中'].includes(x.status)) return false;
        if (x.status === '测试中' && x.workItemType !== '測試') return false;
        return true;
    });
    const num = numeratorList.length;
    const den = denominatorList.length;
    
    let qaAlertActive = false;
    if (den === 0) {
        if (num > 0) qaAlertActive = true;
    } else {
        const ratio = num / den;
        if (ratio > 5.0) qaAlertActive = true;
    }
    
    const activeItems = items.filter(x => !isItemCompleted(x));
    const assignees = [...new Set(items.map(x => x.assignee).filter(Boolean))];
    const workload = {};
    assignees.forEach(name => {
        workload[name] = 0;
    });
    activeItems.forEach(x => {
        if (x.assignee) {
            workload[x.assignee] = (workload[x.assignee] || 0) + 1;
        }
    });
    
    let feTotalActive = 0, feCount = 0;
    let beTotalActive = 0, beCount = 0;
    let mobileTotalActive = 0, mobileCount = 0;
    let uiTotalActive = 0, uiCount = 0;
    
    assignees.forEach(name => {
        const role = inferDeveloperRole(name, items);
        const count = workload[name] || 0;
        if (role === 'Frontend') {
            feTotalActive += count;
            feCount++;
        } else if (role === 'Backend') {
            beTotalActive += count;
            beCount++;
        } else if (role === 'Mobile') {
            mobileTotalActive += count;
            mobileCount++;
        } else if (role === 'UI') {
            uiTotalActive += count;
            uiCount++;
        }
    });
    
    const FE_avg = feCount > 0 ? (feTotalActive / feCount) : 0;
    const BE_avg = beCount > 0 ? (beTotalActive / beCount) : 0;
    const Mobile_avg = mobileCount > 0 ? (mobileTotalActive / mobileCount) : 0;
    const UI_avg = uiCount > 0 ? (uiTotalActive / uiCount) : 0;
    
    // We will use UI_avg directly for density warning
    const uiActiveTasks = activeItems.filter(x => {
        const isUiDev = x.assignee && inferDeveloperRole(x.assignee, items) === 'UI';
        const hasUiKeywords = /ui|设计|切图|样机|交互/i.test((x.title || '') + ' ' + (x.category || ''));
        return isUiDev || hasUiKeywords;
    });
    const UI_count = uiActiveTasks.length;
    
    const advices = [];
    
    // Rule 1: Backend Jam
    if (BE_avg > 3.0 && FE_avg < 1.5) {
        advices.push({
            type: 'jam-be',
            text: `⚠️ 服务端研发拥堵：后端开发人均负荷为 ${BE_avg.toFixed(1)} 个活跃任务，前端为 ${FE_avg.toFixed(1)}。建议产品（Product）与项目经理（PM）暂停输出后端依赖型需求，并放缓新功能排期。`
        });
    }
    
    // Rule 2: Frontend Jam
    if (FE_avg > 3.0 && BE_avg < 1.5) {
        advices.push({
            type: 'jam-fe',
            text: `⚠️ 前端研发拥堵：前端开发人均负荷为 ${FE_avg.toFixed(1)} 个活跃任务，后端为 ${BE_avg.toFixed(1)}。建议后端适当放缓开发，集中资源协助前端联调、修复Bug或进行代码走查。`
        });
    }
    
    // Rule 3: Mobile Release Block
    if (Mobile_avg > 3.0 && num > 5) {
        advices.push({
            type: 'jam-mobile',
            text: `⚠️ 移动端发布拥堵：移动端人均负荷为 ${Mobile_avg.toFixed(1)} 且测试队列拥堵。建议产品放缓App版本特性发布，优先安排热修复或已有缺陷的验证上线。`
        });
    }
    
    // Rule 4: UI Design Bottleneck
    if (UI_count > 4 && FE_avg < 1.5) {
        advices.push({
            type: 'jam-ui',
            text: `⚠️ UI设计阻塞：UI设计在排任务积压达 ${UI_count} 个，导致前端开发无图可用。建议项目经理（PM）紧急协调设计资源，或让产品与后端开发优先推进非UI依赖的底层逻辑。`
        });
    }
    
    // Rule 5: QA & FE Jam, BE & Product Free
    if (qaAlertActive && FE_avg > 2.5 && BE_avg < 1.0) {
        advices.push({
            type: 'jam-double',
            text: `⚠️ 研发中下游阻塞：当前测试队列阻塞且前端负荷高，但后端及产品人员空闲。建议产品与项目经理优先将工作重心转移至“纯后端重构型”或“数据库/性能优化”需求的预研与排期。`
        });
    }
    
    // Rule 6: Backend Resource Idle
    if (BE_avg < 1.0 && beCount > 0) {
        advices.push({
            type: 'idle-be',
            text: `⚠️ 服务端资源闲置：后端开发人均负荷仅为 ${BE_avg.toFixed(1)} 个活跃任务。建议项目经理与产品人员加速后端接口与需求排期，或合理安排人员进行技术债清理、慢SQL优化与微服务架构重构。`
        });
    }
    
    // Rule 7: Frontend Resource Idle
    if (FE_avg < 1.0 && feCount > 0) {
        advices.push({
            type: 'idle-fe',
            text: `⚠️ 前端资源闲置：前端开发人均负荷仅为 ${FE_avg.toFixed(1)} 个活跃任务。建议项目经理加速UI设计图输出，或向前推进前端通用组件库整理、前端工程化升级与体验优化预研。`
        });
    }
    
    // Rule 8: Mobile Resource Idle
    if (Mobile_avg < 1.0 && mobileCount > 0) {
        advices.push({
            type: 'idle-mobile',
            text: `⚠️ 移动端资源闲置：移动端开发人均负荷仅为 ${Mobile_avg.toFixed(1)} 个活跃任务。建议安排热修复包整理、跨平台技术升级或移动端核心代码模块重构。`
        });
    }
    
    // Rule 9: UI Design Resource Idle
    if (UI_avg < 1.0 && uiCount > 0) {
        advices.push({
            type: 'idle-ui',
            text: `⚠️ UI设计资源闲置：UI设计人均负荷仅为 ${UI_avg.toFixed(1)} 个活跃任务。建议产品提前输出后续迭代的原型图并与之进行评审，以便交互与视觉设计能更早介入。`
        });
    }
    
    return advices;
}

function renderStrategicAdvices(items) {
    const container = document.getElementById('strategic-advice-panel');
    if (!container) return;
    container.innerHTML = '';
    
    const advices = getStrategicAdvices(items);
    advices.forEach(adv => {
        const card = document.createElement('div');
        card.className = `strategic-advice-card ${adv.type}`;
        card.innerHTML = `
            <div class="strategic-advice-icon">💡</div>
            <div class="strategic-advice-text">${escapeHtml(adv.text)}</div>
        `;
        container.appendChild(card);
    });
}

function renderRiskRadar(items) {
    const container = document.getElementById('risk-radar-alerts');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 1. QA Bottleneck check
    const activeTasks = items.filter(x => x.category === 'Task');
    const numeratorList = activeTasks.filter(x => {
        if (!['提交测试', '待测试', '已提测', '发包已测试'].includes(x.status)) return false;
        if (x.status === '提交测试' && x.workItemType !== '測試') return false;
        return true;
    });
    const denominatorList = activeTasks.filter(x => {
        if (!['测试中'].includes(x.status)) return false;
        if (x.status === '测试中' && x.workItemType !== '測試') return false;
        return true;
    });
    const num = numeratorList.length;
    const den = denominatorList.length;
    
    let qaAlertHtml = '';
    if (den === 0) {
        if (num > 0) {
            qaAlertHtml = `
                <div class="alert-text-block" style="display: flex; justify-content: space-between; align-items: center; border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.1); color: var(--color-amber);">
                    <span>⚠️ 所有测试挂起：测试队列中积压了 ${num} 个任务，但当前无在测任务！请指派测试资源。</span>
                    <button id="btn-propose-mitigation" class="btn-sync" style="padding: 4px 12px; font-size: 11px; margin-left: 10px;">查看缓解对策</button>
                </div>
            `;
        }
    } else {
        const ratio = num / den;
        if (ratio > 5.0) {
            qaAlertHtml = `
                <div class="alert-text-block" style="display: flex; justify-content: space-between; align-items: center; border-color: rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.1); color: var(--color-rose);">
                    <span>⚠️ QA测试队列拥堵：当前提交测试与待测试任务共 ${num} 个，但在测任务仅 ${den} 个，配比为 ${ratio.toFixed(1)} 倍（警告阈值 5.0 倍）！</span>
                    <button id="btn-propose-mitigation" class="btn-sync" style="padding: 4px 12px; font-size: 11px; margin-left: 10px;">查看缓解对策</button>
                </div>
            `;
        }
    }
    
    if (qaAlertHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = qaAlertHtml;
        container.appendChild(tempDiv.firstElementChild);
        
        // Bind Propose Mitigation button click
        const btn = container.querySelector('#btn-propose-mitigation');
        if (btn) {
            btn.addEventListener('click', showQAMitigationModal);
        }
    }
    
    // 2. Critical path delay check
    const baseDate = new Date('2026-06-08T23:59:59');
    const overdueCriticalItems = items.filter(x => isCriticalPath(x) && !isItemCompleted(x) && x.planEnd && new Date(x.planEnd + 'T23:59:59') < baseDate);
    
    overdueCriticalItems.forEach(item => {
        const delayAlertHtml = `
            <div class="alert-text-block" style="display: flex; align-items: center; border-color: rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.08); color: var(--color-rose);">
                <span>⚠️ 关键路径延期：[${item.id}] ${escapeHtml(item.title)} 计划完成时间为 ${item.planEnd}，已逾期未完成！</span>
            </div>
        `;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = delayAlertHtml;
        container.appendChild(tempDiv.firstElementChild);
    });
    
    // Render the Strategic Advice Panel
    renderStrategicAdvices(items);
}

// Global variables to store current search and role filters for audit view
const auditFilters = {
    search: '',
    role: 'all',
    ignoreReq: false
};

// Render Audit View
function renderAuditView() {
    const lastUpdatedEl = document.getElementById('audit-last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = state.compiledAt ? formatDate(new Date(state.compiledAt)) : 'N/A';
    }

    const items = state.latest[state.currentProject] || [];

    // Get current filter values
    const searchQuery = auditFilters.search.trim().toLowerCase();
    const selectedRole = auditFilters.role;

    // --- Part A: Date Missing Audit ---
    const missingDateItems = items.filter(x => {
        if (isItemCompleted(x)) return false;
        if (!x.assignee) return false;
        
        const allowedCategories = auditFilters.ignoreReq ? ['Task'] : ['Task', 'Req'];
        if (!allowedCategories.includes(x.category)) return false;
        
        return !x.planStart || !x.planEnd;
    });

    // Group by assignee
    const missingGroups = {};
    missingDateItems.forEach(item => {
        const name = item.assignee;
        if (!missingGroups[name]) {
            missingGroups[name] = [];
        }
        missingGroups[name].push(item);
    });

    // Filter missing groups based on search & role
    const filteredMissingGroups = {};
    Object.entries(missingGroups).forEach(([name, list]) => {
        const roleKey = DEVELOPER_ROLES_MAP[name] || 'Fullstack';
        
        // Match Search Query
        const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
        // Match Role Select
        const matchesRole = selectedRole === 'all' || roleKey === selectedRole;

        if (matchesSearch && matchesRole) {
            filteredMissingGroups[name] = list;
        }
    });

    // Render Date Missing Panel
    const missingContainer = document.getElementById('audit-missing-dates-container');
    if (missingContainer) {
        missingContainer.innerHTML = '';
        const keys = Object.keys(filteredMissingGroups);
        if (keys.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'message-list';
            keys.forEach(name => {
                const list = filteredMissingGroups[name];
                const roleKey = DEVELOPER_ROLES_MAP[name] || 'Fullstack';
                const roleName = roleMeta[roleKey] ? roleMeta[roleKey].name : '开发成员';
                
                const taskLinks = list.map(item => {
                    const icon = item.category === 'Req' ? '💭' : (item.category === 'Task' ? '💡' : (item.category === 'Bug' ? '🚨' : ''));
                    return `
                        <span class="message-task-link" onclick="showItemDetailById('${item.id}')" title="点击查看详情">
                            ${icon} [${item.id}] ${escapeHtml(item.title.substring(0, 20))}${item.title.length > 20 ? '...' : ''}
                        </span>
                    `;
                }).join(', ');
                
                const li = document.createElement('li');
                li.className = 'message-item warning';
                li.innerHTML = `
                    <span class="message-badge badge-warning">排期缺失</span>
                    <strong style="color: var(--color-amber);">${escapeHtml(name)} (${roleName})</strong>: 
                    有 ${list.length} 个进行中任务缺少计划时间：${taskLinks}
                `;
                ul.appendChild(li);
            });
            missingContainer.appendChild(ul);
        } else {
            missingContainer.innerHTML = `
                <div class="message-empty success">
                    <span class="message-empty-icon">✅</span>
                    <span>没有符合当前筛选条件的排期缺失记录。</span>
                </div>
            `;
        }
    }

    // --- Part B: Idle Resources Audit ---
    const auditedRoles = ['Frontend', 'Backend', 'Mobile', 'UI', 'Tester', 'Product', 'PM', 'Ops'];
    const idleMembersByRole = {
        Frontend: [],
        Backend: [],
        Mobile: [],
        UI: [],
        Tester: [],
        Product: [],
        PM: [],
        Ops: []
    };

    // 跨项目全局统计活跃未完成任务数，确保成员在所有项目均无工作时才算闲置
    const allProjectsItems = [
        ...(state.latest['mftb'] || []),
        ...(state.latest['mfood'] || [])
    ];
    
    const activeItemCounts = {};
    allProjectsItems.forEach(x => {
        if (x.assignee && !isItemCompleted(x)) {
            activeItemCounts[x.assignee] = (activeItemCounts[x.assignee] || 0) + 1;
        }
    });

    // Find who has 0 active items
    Object.entries(DEVELOPER_ROLES_MAP).forEach(([name, role]) => {
        if (auditedRoles.includes(role)) {
            const activeCount = activeItemCounts[name] || 0;
            if (activeCount === 0) {
                // Match search and role select
                const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
                const matchesRole = selectedRole === 'all' || role === selectedRole;
                if (matchesSearch && matchesRole) {
                    idleMembersByRole[role].push(name);
                }
            }
        }
    });

    const idleContainer = document.getElementById('audit-idle-members-container');
    if (idleContainer) {
        idleContainer.innerHTML = '';
        const totalIdleCount = Object.values(idleMembersByRole).reduce((sum, arr) => sum + arr.length, 0);

        if (totalIdleCount > 0) {
            const ul = document.createElement('ul');
            ul.className = 'message-list';
            Object.entries(idleMembersByRole).forEach(([role, members]) => {
                if (members.length > 0) {
                    const roleName = roleMeta[role].name;
                    const badgeClass = roleMeta[role].badge;
                    const li = document.createElement('li');
                    li.className = 'message-item info';
                    li.innerHTML = `
                        <span class="message-badge ${badgeClass}">${roleName}</span>
                        <strong>空闲人员 (${members.length}人)</strong>: 
                        <span style="color: var(--color-text-primary); font-weight: 500;">
                            ${members.map(m => escapeHtml(m)).join(', ')}
                        </span>
                    `;
                    ul.appendChild(li);
                }
            });
            idleContainer.appendChild(ul);
        } else {
            idleContainer.innerHTML = `
                <div class="message-empty info">
                    <span class="message-empty-icon">💡</span>
                    <span>没有符合当前筛选条件的空闲人员记录。</span>
                </div>
            `;
        }
    }

    // --- Part C: Healthy Resources Audit ---
    // 统计在当前项目中：有正在开发中的活跃任务，且所有任务计划起止时间排期完整的规范开发人员
    const healthyMembersByRole = {
        Frontend: [],
        Backend: [],
        Mobile: [],
        UI: [],
        Tester: [],
        Product: [],
        PM: [],
        Ops: []
    };

    const healthyMemberTasks = {};

    Object.entries(DEVELOPER_ROLES_MAP).forEach(([name, role]) => {
        if (auditedRoles.includes(role)) {
            // 当前项目下的未完成活跃卡片
            const currentProjectActiveItems = items.filter(x => x.assignee === name && !isItemCompleted(x));
            const activeCount = currentProjectActiveItems.length;
            
            if (activeCount > 0) {
                // 检查这些卡片中是否有缺失排期的（计划起止时间漏填的）
                const allowedCategories = auditFilters.ignoreReq ? ['Task'] : ['Task', 'Req'];
                const hasMissingDate = currentProjectActiveItems.some(x => 
                    allowedCategories.includes(x.category) && (!x.planStart || !x.planEnd)
                );
                
                if (!hasMissingDate) {
                    // 符合排期规范且正在饱和开发中的条件
                    const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery);
                    const matchesRole = selectedRole === 'all' || role === selectedRole;
                    if (matchesSearch && matchesRole) {
                        healthyMembersByRole[role].push(name);
                        healthyMemberTasks[name] = currentProjectActiveItems;
                    }
                }
            }
        }
    });

    const healthyContainer = document.getElementById('audit-healthy-members-container');
    if (healthyContainer) {
        healthyContainer.innerHTML = '';
        const totalHealthyCount = Object.values(healthyMembersByRole).reduce((sum, arr) => sum + arr.length, 0);

        if (totalHealthyCount > 0) {
            const ul = document.createElement('ul');
            ul.className = 'message-list';
            Object.entries(healthyMembersByRole).forEach(([role, members]) => {
                if (members.length > 0) {
                    const roleName = roleMeta[role].name;
                    const badgeClass = roleMeta[role].badge;
                    
                    members.forEach(name => {
                        const list = healthyMemberTasks[name];
                        const taskLinks = list.map(item => {
                            const icon = item.category === 'Req' ? '💭' : (item.category === 'Task' ? '💡' : (item.category === 'Bug' ? '🚨' : ''));
                            return `
                                <span class="message-task-link" onclick="showItemDetailById('${item.id}')" title="点击查看详情" style="color: var(--color-emerald); border-bottom-color: rgba(16, 185, 129, 0.3);">
                                    ${icon} [${item.id}] ${escapeHtml(item.title.substring(0, 20))}${item.title.length > 20 ? '...' : ''}
                                </span>
                            `;
                        }).join(', ');

                        const li = document.createElement('li');
                        li.className = 'message-item success';
                        li.innerHTML = `
                            <span class="message-badge ${badgeClass}" style="background: rgba(16, 185, 129, 0.15); color: var(--color-emerald); border-color: rgba(16, 185, 129, 0.3);">${roleName}</span>
                            <strong style="color: var(--color-emerald);">${escapeHtml(name)}</strong>: 
                            正在负责 ${list.length} 个排期规范任务：${taskLinks}
                        `;
                        ul.appendChild(li);
                    });
                }
            });
            healthyContainer.appendChild(ul);
        } else {
            healthyContainer.innerHTML = `
                <div class="message-empty success">
                    <span class="message-empty-icon">💡</span>
                    <span>没有符合当前筛选条件的排期规范开发中人员。</span>
                </div>
            `;
        }
    }
}

// Helper to show detail modal by item ID
function showItemDetailById(id) {
    const items = state.latest[state.currentProject] || [];
    const item = items.find(x => x.id === id);
    if (item) {
        showItemDetail(item);
    }
}
window.showItemDetailById = showItemDetailById;

function showQAMitigationModal() {
    const modal = document.getElementById('qa-mitigation-modal');
    if (!modal) return;
    
    const items = state.latest[state.currentProject] || [];
    
    // Set warning note and title description dynamically
    const descEl = modal.querySelector('.section-desc');
    if (descEl) {
        descEl.innerHTML = '测试工作专业性强，优先推荐空闲的测试同仁，并建议协调产品协助功能验收测试，避免盲目指派开发人员抢占测试资源。<br><span style="color: var(--color-rose); font-weight: 500; display: block; margin-top: 8px;">*测试工作专业性强，优先推荐空闲的测试同仁，并建议协调产品协助功能验收测试，避免盲目指派开发人员抢占测试资源。</span>';
    }
    const thEl = modal.querySelector('.data-table th:first-child');
    if (thEl) {
        thEl.textContent = '团队成员';
    }
    
    // Active workload: Tasks/Bugs assigned to them that are not in testing/completed
    const activeDevTasks = items.filter(x => {
        if (x.category !== 'Task' && x.category !== 'Bug') return false;
        if (isItemCompleted(x)) return false;
        const testingStatuses = ['提交测试', '测试中', '待测试', '已提测', '发包已测试'];
        if (testingStatuses.includes(x.status)) return false;
        return true;
    });
    
    const allAssignees = [...new Set(items.map(x => x.assignee).filter(Boolean))];
    
    const workload = {};
    allAssignees.forEach(name => {
        workload[name] = 0;
    });
    activeDevTasks.forEach(x => {
        if (x.assignee) {
            workload[x.assignee] = (workload[x.assignee] || 0) + 1;
        }
    });
    
    const sortedDevs = Object.entries(workload).sort((a, b) => a[1] - b[1]);
    
    // Filter and Sort: Testers first (ascending by workload), then Product members (ascending by workload)
    const testers = sortedDevs.filter(([name]) => inferDeveloperRole(name, items) === 'Tester');
    const productMembers = sortedDevs.filter(([name]) => inferDeveloperRole(name, items) === 'Product');
    const recommendedPeople = [...testers, ...productMembers];
    
    const tbody = document.getElementById('mitigation-devs-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        recommendedPeople.forEach(([name, count]) => {
            const tr = document.createElement('tr');
            
            let badgeHtml = '';
            if (count <= 1) {
                badgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--color-emerald); border: 1px solid rgba(16, 185, 129, 0.3);">可支援</span>`;
            } else {
                badgeHtml = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid var(--border-color);">繁忙</span>`;
            }
            
            const role = inferDeveloperRole(name, items);
            const meta = roleMeta[role] || { name: '未知', badge: 'badge-role-other' };
            const roleBadgeHtml = `<span class="badge ${meta.badge}">${meta.name}</span>`;
            
            const pingLink = `slack://user?name=${encodeURIComponent(name)}`;
            const pingHtml = `<a href="${pingLink}" style="color: var(--color-primary); text-decoration: none;" class="ping-link">💬 Ping on Slack</a>`;
            
            tr.innerHTML = `
                <td class="cell-title">${escapeHtml(name)}</td>
                <td>${roleBadgeHtml}</td>
                <td>${count} 个</td>
                <td>${badgeHtml}</td>
                <td>${pingHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    const tipsContainer = document.querySelector('.mitigation-tips-list');
    if (tipsContainer) {
        const personA = recommendedPeople[0] ? recommendedPeople[0][0] : '无人员';
        const roleA = recommendedPeople[0] ? inferDeveloperRole(personA, items) : '';
        const roleAName = roleA ? (roleMeta[roleA] || { name: '成员' }).name : '成员';
        
        const personB = recommendedPeople[1] ? recommendedPeople[1][0] : '无人员';
        const roleB = recommendedPeople[1] ? inferDeveloperRole(personB, items) : '';
        const roleBName = roleB ? (roleMeta[roleB] || { name: '成员' }).name : '成员';
        
        let mitigationTip = `建议指派负载较低的 <strong>${escapeHtml(personA)}</strong> (${roleAName}) 和 <strong>${escapeHtml(personB)}</strong> (${roleBName}) 支援高优先级任务的测试验证与功能验收。`;
        
        tipsContainer.innerHTML = `
            <li style="margin-bottom: 6px;"><strong>暂停代码合并</strong>: 建议暂时暂停非关键需求的合码，以减少 QA 测试负担。</li>
            <li style="margin-bottom: 6px;">${mitigationTip}</li>
        `;
    }
    
    modal.classList.add('active');
    modal.style.display = 'flex';
}

function hideQAMitigationModal() {
    const modal = document.getElementById('qa-mitigation-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}


// ============================================================================
// Clipboard Markdown Exporter
// ============================================================================

function exportMarkdownSnippet() {
    const projectMap = {
        mftb: 'MFTB 集团项目',
        mfood: 'mFood 综合版本'
    };
    const projectName = projectMap[state.currentProject] || state.currentProject;
    const now = new Date();
    
    const pad = (n) => n.toString().padStart(2, '0');
    const exportTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const searchVal = document.getElementById('filter-search') ? document.getElementById('filter-search').value.trim() : '';
    const categoryVal = document.getElementById('filter-category') ? document.getElementById('filter-category').value : 'all';
    const statusVal = document.getElementById('filter-status') ? document.getElementById('filter-status').value : 'all';
    const assVal = document.getElementById('filter-assignee') ? document.getElementById('filter-assignee').value : 'all';
    const prioVal = document.getElementById('filter-priority') ? document.getElementById('filter-priority').value : 'all';
    const iterVal = document.getElementById('filter-iteration') ? document.getElementById('filter-iteration').value : 'all';
    const bizLineVal = document.getElementById('filter-business-line') ? document.getElementById('filter-business-line').value : 'all';

    const filterStrings = [];
    if (searchVal) filterStrings.push(`搜索: "${searchVal}"`);
    filterStrings.push(`类型: ${categoryVal === 'all' ? '全部类型' : (categoryVal === 'Req' ? '需求' : (categoryVal === 'Task' ? '任务' : '缺陷'))}`);
    filterStrings.push(`状态: ${statusVal === 'all' ? '全部状态' : statusVal}`);
    filterStrings.push(`负责人: ${assVal === 'all' ? '全部负责人' : assVal}`);
    if (prioVal !== 'all' && prioVal !== null) filterStrings.push(`优先级: ${prioVal}`);
    if (iterVal !== 'all' && iterVal !== null) filterStrings.push(`迭代: ${iterVal}`);
    if (bizLineVal !== 'all' && bizLineVal !== null) filterStrings.push(`业务线: ${bizLineVal === 'daojia' ? '到家业务' : '到店业务'}`);
    const filtersLabel = filterStrings.join(' | ');

    const items = state.latest[state.currentProject] || [];
    const filtered = items.filter(x => {
        if (searchVal) {
            const matchTitle = x.title.toLowerCase().includes(searchVal.toLowerCase());
            const matchRow = (x.rowText || '').toLowerCase().includes(searchVal.toLowerCase());
            const matchId = (x.id || '').toLowerCase().includes(searchVal.toLowerCase());
            if (!matchTitle && !matchRow && !matchId) return false;
        }
        if (categoryVal !== 'all' && x.category !== categoryVal) return false;
        if (statusVal !== 'all' && x.status !== statusVal) return false;
        if (assVal !== 'all' && x.assignee !== assVal) return false;
        if (prioVal !== 'all' && prioVal !== null && x.priority !== prioVal) return false;
        if (iterVal !== 'all' && iterVal !== null && x.iteration !== iterVal) return false;
        if (bizLineVal !== 'all' && bizLineVal !== null && getBusinessLine(x) !== bizLineVal) return false;
        return true;
    });

    const total = filtered.length;
    const completed = filtered.filter(x => isItemCompleted(x)).length;
    const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    const leadTime = (state.leadTimeKPI[state.currentProject] || { average: 0 }).average;

    const riskMessages = [];
    
    const activeTasks = items.filter(x => x.category === 'Task');
    const numeratorList = activeTasks.filter(x => {
        if (!['提交测试', '待测试', '已提测', '发包已测试'].includes(x.status)) return false;
        if (x.status === '提交测试' && x.workItemType !== '測試') return false;
        return true;
    });
    const denominatorList = activeTasks.filter(x => {
        if (!['测试中'].includes(x.status)) return false;
        if (x.status === '测试中' && x.workItemType !== '測試') return false;
        return true;
    });
    const num = numeratorList.length;
    const den = denominatorList.length;
    
    if (den === 0) {
        if (num > 0) {
            riskMessages.push(`⚠️ 所有测试挂起：测试队列中积压了 ${num} 个任务，但当前无在测任务！请指派测试资源。`);
        }
    } else {
        const ratio = num / den;
        if (ratio > 5.0) {
            riskMessages.push(`⚠️ QA测试队列拥堵：当前提交测试与待测试任务共 ${num} 个，但在测任务仅 ${den} 个，配比为 ${ratio.toFixed(1)} 倍（警告阈值 5.0 倍）！`);
        }
    }

    const baseDate = new Date('2026-06-08T23:59:59');
    const overdueCriticalItems = filtered.filter(x => isCriticalPath(x) && !isItemCompleted(x) && x.planEnd && new Date(x.planEnd + 'T23:59:59') < baseDate);
    overdueCriticalItems.forEach(item => {
        riskMessages.push(`⚠️ 关键路径延期：[${item.id}] ${item.title} 计划完成时间为 ${item.planEnd}，已逾期未完成！`);
    });

    const riskSection = riskMessages.length > 0
        ? riskMessages.map(m => `  - ${m}`).join('\n')
        : '  - 暂无卡点风险提示';

    const advices = getStrategicAdvices(items);
    const adviceLines = advices.length > 0
        ? advices.map(a => `  - ${a.text}`).join('\n')
        : '  - 暂无研发效能卡点与流控建议。';

    let tableRows = '';
    filtered.forEach(x => {
        const dateLabel = x.planStart ? `${x.planStart} 至 ${x.planEnd || '-'}` : '未排期';
        tableRows += `| ${x.id || '-'} | ${escapeHtml(x.title)} | ${escapeHtml(x.assignee)} | ${x.status || '-'} | ${x.priority || '-'} | ${dateLabel} |\n`;
    });

    const markdown = `### [${projectName}] 研发进度周报
* **导出时间**: ${exportTime}
* **筛选条件**: ${filtersLabel}
* **核心数据统计**:
  - 累计项: ${total} | 已完成/已验证: ${completed} (完成率: ${rate}%)
  - 需求平均交付周期: ${leadTime.toFixed(1)} 天
* **卡点风险提示**: 
${riskSection}

### * 研发效能与流控建议
${adviceLines}

* **过滤明细表**:
  | ID | 标题 | 负责人 | 状态 | 优先级 | 计划时间 |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  ${tableRows.trim()}

---
*Generated by MFTB Collaboration Dashboard | [Give Feedback]*`;

    navigator.clipboard.writeText(markdown).then(() => {
        showToast('已复制周报 Snippet 到剪贴板！');
    }).catch(err => {
        console.error('Failed to copy markdown:', err);
        showToast('复制失败，请手动选择复制。');
    });
}




// ============================================================
// 五维升级模块：风险预警 | 站会看板 | 配置管理 | 弹窗增强
// ============================================================

// ---------- P0: 风险预警中心 ----------

function renderRiskCenter() {
    const items = state.latest[state.currentProject] || [];
    const history = state.history[state.currentProject] || [];
    
    // 风险 KPI
    const delayedItems = findDelayedItems(items, history);
    renderRiskKPIs(items, delayedItems);
    renderBurndownChart(items, history);
    renderDelayPrediction(delayedItems);
    renderDependencyDetection(items);
    renderEfficiencyBoard(items);
}

function findDelayedItems(items, history) {
    const now = new Date();
    const results = [];
    const activeStatuses = ['开发中', '进行中', '处理中', '测试中', '待测试', '待验收'];
    const avgCycleDays = computeAvgCycleDays(history, items);
    
    for (const item of items) {
        const status = item.status || '';
        if (!activeStatuses.some(s => status.includes(s))) continue;
        
        const created = item.created_at || item.created;
        if (!created) continue;
        const daysSinceCreated = Math.max(0, Math.floor((now - new Date(created)) / 86400000));
        
        let riskLevel = 'low';
        if (daysSinceCreated > avgCycleDays * 1.5) riskLevel = 'high';
        else if (daysSinceCreated > avgCycleDays) riskLevel = 'medium';
        
        results.push({ ...item, daysSinceCreated, avgCycleDays, riskLevel });
    }
    
    results.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.riskLevel] || 3) - (order[b.riskLevel] || 3);
    });
    return results;
}

function computeAvgCycleDays(history, items) {
    let totalDays = 0, count = 0;
    const completedStatuses = ['已完成', '已上线', '已验证', '已关闭', '已发布'];
    
    for (const item of items) {
        const status = item.status || '';
        if (!completedStatuses.some(s => status.includes(s))) continue;
        const created = item.created_at || item.created;
        const updated = item.updated_at || item.updated;
        if (created && updated) {
            totalDays += Math.max(1, Math.floor((new Date(updated) - new Date(created)) / 86400000));
            count++;
        }
    }
    return count > 0 ? Math.round(totalDays / count) : 14;
}

function renderRiskKPIs(items, delayedItems) {
    const container = document.getElementById('risk-kpi-area');
    if (!container) return;
    
    const highCount = delayedItems.filter(d => d.riskLevel === 'high').length;
    const medCount = delayedItems.filter(d => d.riskLevel === 'medium').length;
    const total = items.length;
    const completed = items.filter(i => {
        const s = i.status || '';
        return ['已完成', '已上线', '已验证', '已关闭', '已发布'].some(cs => s.includes(cs));
    }).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // 预测剩余天数
    const active = items.filter(i => {
        const s = i.status || '';
        return ['开发中', '进行中', '处理中', '测试中', '待测试'].some(ss => s.includes(ss));
    }).length;
    const recentRate = computeRecentVelocity(items, history);
    const estDays = recentRate > 0 ? Math.round(active / recentRate * 7) : '--';
    
    container.innerHTML = `<div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#f87171;">${highCount}</div><div class="risk-kpi-label">🔴 高风险延期</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#fbbf24;">${medCount}</div><div class="risk-kpi-label">🟡 中等风险</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#38bdf8;">${active}</div><div class="risk-kpi-label">⚙️ 活跃需求</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#4ade80;">${estDays}天</div><div class="risk-kpi-label">📅 预计完成(按速率)</div></div>
    <div class="risk-kpi-card"><div class="risk-kpi-value" style="color:#c084fc;">${rate}%</div><div class="risk-kpi-label">📊 交付率</div></div>`;
}

function computeRecentVelocity(items, history) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000);
    let completed = 0;
    const completedStatuses = ['已完成', '已上线', '已验证', '已关闭', '已发布'];
    for (const item of items) {
        const status = item.status || '';
        if (!completedStatuses.some(s => status.includes(s))) continue;
        const updated = item.updated_at || item.updated;
        if (updated && new Date(updated) >= thirtyDaysAgo) completed++;
    }
    return completed > 0 ? (completed / 30) : 0;
}

// 燃尽图
let burndownChartInstance = null;
function renderBurndownChart(items, history) {
    const canvas = document.getElementById('chart-burndown');
    if (!canvas) return;
    if (burndownChartInstance) burndownChartInstance.destroy();
    
    const active = items.filter(i => {
        const s = i.status || '';
        return !['已完成', '已上线', '已验证', '已关闭', '已发布', '已取消', '已拒绝'].some(cs => s.includes(cs));
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

// 延期预测表
function renderDelayPrediction(delayedItems) {
    const container = document.getElementById('risk-delay-table-container');
    if (!container) return;
    
    if (delayedItems.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">✅ 当前没有延期风险需求</p>';
        return;
    }
    
    const rows = delayedItems.map(d => {
        const riskClass = d.riskLevel === 'high' ? 'high' : (d.riskLevel === 'medium' ? 'medium' : 'low');
        const riskLabel = d.riskLevel === 'high' ? '高风险' : (d.riskLevel === 'medium' ? '中风险' : '低风险');
        const id = d.id || d.workitem_id || '-';
        const title = (d.title || d.subject || '-').substring(0, 60);
        const assignee = d.assignee || d.assigned_to || '-';
        const status = d.status || '-';
        const days = d.daysSinceCreated || 0;
        const avg = d.avgCycleDays || 0;
        
        return `<tr>
            <td><span class="dep-table clickable" data-wid="${escapeHtml(String(id))}">${escapeHtml(String(id))}</span></td>
            <td>${escapeHtml(title)}</td>
            <td>${escapeHtml(assignee)}</td>
            <td>${escapeHtml(status)}</td>
            <td>${days}天</td>
            <td>${avg}天</td>
            <td><span class="risk-badge ${riskClass}">${riskLabel}</span></td>
        </tr>`;
    }).join('');
    
    container.innerHTML = `<table class="dep-table"><thead><tr>
        <th>ID</th><th>标题</th><th>负责人</th><th>状态</th><th>已耗时</th><th>历史均值</th><th>风险</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
    
    // 事件委托：点击行打开详情
    container.querySelectorAll('.clickable[data-wid]').forEach(el => {
        el.addEventListener('click', () => {
            const wid = el.dataset.wid;
            const item = (state.latest[state.currentProject] || []).find(i => String(i.id || i.workitem_id || '') === wid);
            if (item && typeof showItemDetailById === 'function') showItemDetailById(item);
        });
    });
}

// 依赖检测
function renderDependencyDetection(items) {
    const container = document.getElementById('risk-dependency-container');
    if (!container) return;
    
    const criticalKeywords = loadConfig('criticalKeywords', ['支付', '下单', '结算', '登录', '核心', '主流程']);
    const dependencies = [];
    
    for (const item of items) {
        const title = (item.title || item.subject || '').toLowerCase();
        for (const kw of criticalKeywords) {
            if (title.includes(kw.toLowerCase())) {
                const status = item.status || '';
                const isDone = ['已完成', '已上线', '已验证', '已关闭'].some(s => status.includes(s));
                dependencies.push({
                    id: item.id || item.workitem_id,
                    title: item.title || item.subject || '-',
                    status,
                    isDone,
                    keyword: kw,
                    assignee: item.assignee || '-'
                });
                break;
            }
        }
    }
    
    if (dependencies.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">未检测到关键路径依赖项（可在配置管理中设置关键字）</p>';
        return;
    }
    
    const undones = dependencies.filter(d => !d.isDone);
    const dones = dependencies.filter(d => d.isDone);
    
    container.innerHTML = `
    <div style="margin-bottom:12px;"><span style="color:#f87171;font-weight:600;">⚠️ 未完成 ${undones.length}</span> / 总计 ${dependencies.length} 项关键依赖</div>
    <table class="dep-table"><thead><tr><th>ID</th><th>标题</th><th>状态</th><th>关键字</th><th>负责人</th><th>风险</th></tr></thead><tbody>
        ${[...undones, ...dones].map(d => {
            const riskBadge = d.isDone ? '<span class="risk-badge low">已完成</span>' : '<span class="risk-badge high">未完成</span>';
            return `<tr>
                <td><span class="dep-table clickable" data-wid="${escapeHtml(String(d.id))}">${escapeHtml(String(d.id))}</span></td>
                <td>${escapeHtml((d.title || '').substring(0, 40))}</td>
                <td>${escapeHtml(d.status)}</td>
                <td><span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(d.keyword)}</span></td>
                <td>${escapeHtml(d.assignee)}</td>
                <td>${riskBadge}</td>
            </tr>`;
        }).join('')}
    </tbody></table>`;
    
    container.querySelectorAll('.clickable[data-wid]').forEach(el => {
        el.addEventListener('click', () => {
            const wid = el.dataset.wid;
            const item = items.find(i => String(i.id || i.workitem_id || '') === wid);
            if (item && typeof showItemDetailById === 'function') showItemDetailById(item);
        });
    });
}

// 人员效能看板
function renderEfficiencyBoard(items) {
    const container = document.getElementById('risk-efficiency-table-container');
    if (!container) return;
    
    const devMap = {};
    for (const item of items) {
        const assignee = item.assignee || item.assigned_to || '未指派';
        if (!devMap[assignee]) devMap[assignee] = { name: assignee, total: 0, completed: 0, delayed: 0, active: 0 };
        devMap[assignee].total++;
        
        const status = item.status || '';
        if (['已完成', '已上线', '已验证', '已关闭', '已发布'].some(s => status.includes(s))) {
            devMap[assignee].completed++;
        } else if (['开发中', '进行中', '处理中', '测试中', '待测试'].some(s => status.includes(s))) {
            devMap[assignee].active++;
        }
        
        const created = item.created_at || item.created;
        if (created && !['已完成', '已上线', '已验证', '已关闭', '已发布', '已取消'].some(s => status.includes(s))) {
            const days = Math.floor((new Date() - new Date(created)) / 86400000);
            if (days > 14) devMap[assignee].delayed++;
        }
    }
    
    const devs = Object.values(devMap).sort((a, b) => b.total - a.total);
    
    if (devs.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:16px;">暂无数据</p>';
        return;
    }
    
    container.innerHTML = `<table class="dep-table"><thead><tr>
        <th>成员</th><th>总需求</th><th>已完成</th><th>活跃中</th><th>延期项</th><th>完成率</th>
    </tr></thead><tbody>${devs.map(d => {
        const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        const delayedClass = d.delayed > 0 ? 'color:#f87171' : '';
        return `<tr>
            <td style="font-weight:500;">${escapeHtml(d.name)}</td>
            <td>${d.total}</td>
            <td style="color:#4ade80;">${d.completed}</td>
            <td>${d.active}</td>
            <td style="${delayedClass}">${d.delayed}</td>
            <td>${rate}%</td>
        </tr>`;
    }).join('')}</tbody></table>`;
}

// ---------- P4: 配置管理 ----------

function renderConfigCenter() {
    const roles = loadConfig('roles', {});
    const milestones = loadConfig('milestones', {});
    const criticalKeywords = loadConfig('criticalKeywords', []);
    const bizLineConfig = loadBusinessLineConfig();
    
    document.getElementById('config-roles').value = JSON.stringify(roles, null, 2);
    document.getElementById('config-milestones').value = JSON.stringify(milestones, null, 2);
    document.getElementById('config-critical').value = JSON.stringify(criticalKeywords, null, 2);
    document.getElementById('config-bizline-daojia').value = JSON.stringify(bizLineConfig.daojia, null, 2);
    document.getElementById('config-bizline-daodian').value = JSON.stringify(bizLineConfig.daodian, null, 2);
    
    document.getElementById('btn-config-roles-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-roles').value); saveConfig('roles', v); showToast('角色映射已保存'); } catch { showToast('JSON格式错误'); }
    };
    document.getElementById('btn-config-milestones-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-milestones').value); saveConfig('milestones', v); showToast('里程碑已保存'); } catch { showToast('JSON格式错误'); }
    };
    document.getElementById('btn-config-critical-save').onclick = () => {
        try { const v = JSON.parse(document.getElementById('config-critical').value); saveConfig('criticalKeywords', v); showToast('关键字已保存'); } catch { showToast('JSON格式错误'); }
    };
    document.getElementById('btn-config-bizline-save').onclick = () => {
        try {
            const daojia = JSON.parse(document.getElementById('config-bizline-daojia').value);
            const daodian = JSON.parse(document.getElementById('config-bizline-daodian').value);
            if (!Array.isArray(daojia) || !Array.isArray(daodian)) throw new Error('必须是数组');
            saveBusinessLineConfig({ daojia, daodian });
            showToast('业务线关键词已保存');
        } catch (e) { showToast('JSON格式错误: ' + e.message); }
    };
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

function loadConfig(key, defaultVal) {
    try { return JSON.parse(localStorage.getItem('devops_config_' + key) || 'null') || defaultVal; } catch { return defaultVal; }
}
function saveConfig(key, val) {
    localStorage.setItem('devops_config_' + key, JSON.stringify(val));
}

// ---------- 详情弹窗增强 ----------

const originalShowItemDetail = typeof showItemDetail === 'function' ? showItemDetail : null;
const originalShowItemDetailById = typeof showItemDetailById === 'function' ? showItemDetailById : null;

// 劫持 showItemDetailById 来注入增强内容
if (typeof window !== 'undefined') {
    const _origById = window.showItemDetailById;
    window.showItemDetailById = function(item) {
        if (_origById) _origById(item);
        // 增强注入在 modal 打开后
        setTimeout(() => {
            const itemId = item.id || item.workitem_id || '';
            renderStatusTimeline(item);
            renderChecklist(item);
            renderComments(itemId);
        }, 100);
    };
}

function renderStatusTimeline(item) {
    const container = document.getElementById('modal-item-timeline');
    if (!container) return;
    
    const transitions = item.transitions || item.status_history || [];
    const status = item.status || '未知';
    
    if (transitions.length === 0) {
        // 构造一个基于当前状态的简单时间线
        const created = item.created_at || item.created || '';
        const assignee = item.assignee || item.assigned_to || '-';
        container.innerHTML = `<div class="timeline-entry"><div class="timeline-dot"></div><span class="timeline-date">${created ? created.substring(0,10) : '-'}</span><span class="timeline-status">${escapeHtml(status)}</span><span>${escapeHtml(assignee)}</span></div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">提示：详细流转数据需从 history DB 读取。当前显示创建时的状态。</div>`;
        return;
    }
    
    container.innerHTML = transitions.map(t => {
        const date = t.date || t.created || t.timestamp || '';
        const statusName = t.status || t.to_status || '';
        const user = t.user || t.assignee || t.actor || '';
        return `<div class="timeline-entry"><div class="timeline-dot"></div><span class="timeline-date">${date.length >= 10 ? date.substring(0,10) : date}</span><span class="timeline-status">${escapeHtml(statusName)}</span><span>${escapeHtml(user)}</span></div>`;
    }).join('');
}

// Checklist 检查项定义
const CHECKLIST_RULES = {
    '待开发': [{ id: 'req-reviewed', label: '需求已评审通过' }, { id: 'design-done', label: '技术方案已完成' }],
    '开发中': [{ id: 'branch-created', label: '开发分支已创建' }, { id: 'self-tested', label: '自测通过' }],
    '进行中': [{ id: 'branch-created', label: '开发分支已创建' }, { id: 'self-tested', label: '自测通过' }],
    '测试中': [{ id: 'test-case-linked', label: '测试用例已关联' }, { id: 'code-reviewed', label: '代码评审通过' }],
    '待测试': [{ id: 'test-case-linked', label: '测试用例已关联' }, { id: 'code-reviewed', label: '代码评审通过' }],
    '待验收': [{ id: 'acceptance-doc', label: '验收文档已准备' }, { id: 'prod-config', label: '生产配置已就绪' }],
    '待发布': [{ id: 'release-note', label: '发布说明已编写' }, { id: 'rollback-plan', label: '回滚方案已确认' }],
    '待上线': [{ id: 'release-note', label: '发布说明已编写' }, { id: 'rollback-plan', label: '回滚方案已确认' }],
    '_default': [{ id: 'status-updated', label: '状态已同步更新' }]
};

function renderChecklist(item) {
    const container = document.getElementById('modal-item-checklist');
    if (!container) return;
    
    const status = item.status || '';
    let checkItems = null;
    
    for (const [key, items] of Object.entries(CHECKLIST_RULES)) {
        if (status.includes(key)) { checkItems = items; break; }
    }
    if (!checkItems) checkItems = CHECKLIST_RULES._default;
    
    const itemId = String(item.id || item.workitem_id || '');
    const savedChecks = loadChecklistState(itemId);
    
    container.innerHTML = checkItems.map(ci => {
        const checked = savedChecks[ci.id] ? 'checked' : '';
        return `<div class="checklist-row">
            <input type="checkbox" id="cl-${ci.id}" data-cid="${ci.id}" data-item="${escapeHtml(itemId)}" ${checked}>
            <label for="cl-${ci.id}">${ci.label}</label>
        </div>`;
    }).join('');
    
    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', function() {
            saveChecklistItem(itemId, this.dataset.cid, this.checked);
        });
    });
}

function loadChecklistState(itemId) {
    try { return JSON.parse(localStorage.getItem('devops_checklist_' + itemId) || '{}'); } catch { return {}; }
}

function saveChecklistItem(itemId, checkId, checked) {
    const state = loadChecklistState(itemId);
    if (checked) state[checkId] = true;
    else delete state[checkId];
    localStorage.setItem('devops_checklist_' + itemId, JSON.stringify(state));
}

// 评论功能
function renderComments(itemId) {
    const container = document.getElementById('modal-item-comments');
    const input = document.getElementById('modal-comment-input');
    const btn = document.getElementById('btn-modal-comment-submit');
    if (!container) return;
    
    const comments = loadComments(itemId);
    
    container.innerHTML = comments.length === 0
        ? '<p style="color:#94a3b8;font-size:12px;">暂无评论，添加第一条讨论</p>'
        : comments.map(c => `<div class="comment-item"><div class="comment-meta">${escapeHtml(c.author || '匿名')} · ${escapeHtml(c.time || '')}</div><div class="comment-text">${escapeHtml(c.text || '')}</div></div>`).join('');
    
    if (btn) {
        btn.onclick = () => {
            const text = input ? input.value.trim() : '';
            if (!text) return;
            saveComment(itemId, text);
            if (input) input.value = '';
            renderComments(itemId);
        };
    }
}

function loadComments(itemId) {
    try { return JSON.parse(localStorage.getItem('devops_comments_' + itemId) || '[]'); } catch { return []; }
}

function saveComment(itemId, text) {
    const comments = loadComments(itemId);
    comments.push({ text, author: '我', time: new Date().toLocaleString('zh-CN') });
    localStorage.setItem('devops_comments_' + itemId, JSON.stringify(comments));
}
