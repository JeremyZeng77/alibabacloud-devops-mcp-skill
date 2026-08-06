/**
 * 全局状态管理模块
 * state 对象作为模块间数据总线，通过 ES Module 单例特性保证全局唯一
 */

// 全局状态对象（单例）
export const state = {
    compiledAt: null,                   // 数据编译时间戳
    latest: { mftb: [], mfood: [] },    // 当前快照工作项列表
    history: { mftb: [], mfood: [] },   // 历史快照数组
    weeklyReports: [],                  // 周报 Markdown 数组
    currentProject: 'mftb',             // 当前项目: 'mftb' | 'mfood'
    currentView: 'overview',            // 当前视图: 'overview' | 'workitems' | 'weekly' | 'audit' | 'risk' | 'config'
    charts: {},                         // Chart.js 实例引用
    autoSyncIntervalId: null,           // 自动同步定时器 ID（5分钟）
    pollingIntervalId: null,            // 60s 轮询定时器 ID
    chartStatusMode: 'active',          // 图表状态模式: 'active' | 'all'
    ganttViewMode: 'day',               // 甘特图视图模式: 'day' | 'week' | 'month'
    ganttStartDate: null,               // 甘特图起始日期
    ganttCategory: 'Req',               // 甘特图类别: 'Req' | 'Task' | 'Bug'
    ganttExpandedAssignees: {},         // 甘特图展开状态
    leadTimeKPI: {                      // 交付周期 KPI
        mftb: { average: 0, delta: 0 },
        mfood: { average: 0, delta: 0 }
    },
    criticalPathConfig: null,           // 关键路径配置
    pmoAdvice: {},                      // PMO 建议对象
    urlFilters: null                    // URL 参数临时存储
};

/**
 * 将当前状态同步到 URL 参数
 * 支持 project/view/search/category/status/assignee/priority/iteration/bizline
 */
export function syncStateToURL() {
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

/**
 * 从 URL 参数加载状态
 * 读取 project/view 及筛选参数，同步 UI 元素状态
 */
export function loadStateFromURL() {
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

    // 同步 UI 元素到当前状态
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

    // 读取筛选参数存入临时状态，供 populateFilters 使用后清空
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
