/**
 * 全局常量配置模块
 * 集中管理所有静态配置常量，供各模块按需导入
 */

// ── 桥接服务 API 基地址 ──
// 本地开发环境使用当前主机名 + 端口 18790，线上环境 fallback 到 localhost
export const BRIDGE_API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
    ? `http://${window.location.hostname}:18790`
    : 'http://localhost:18790';

// ── 默认业务线关键词配置 ──
export const DEFAULT_BUSINESS_LINE_CONFIG = {
    zhongbao: ['众包','眾包','跑腿','外送','外賣業務'],
    daojia: ['到家业务','到家業務','外卖','外賣','mFood','mfood','闪蜂','閃蜂','極馬','極馬專送','专送','專送','配送','騎手','骑手','調度','调度'],
    daodian: ['團購','团购','到店','大係統','大系統','大系统','商家APP','商家 APP','商家端','商家app','门店','門店','商户','商戶','合同','推广金','推廣金','集團','集团','商家管理','商家入駐'],
    other: []
};

// ── 里程碑配置 ──
export const milestonesConfig = {
    mftb: [
        { name: "MFTB Beta Release", date: "2026-06-12" },
        { name: "MFTB V1.0.0 Online", date: "2026-06-15" }
    ],
    mfood: [
        { name: "mFood V7.2.0 Launch", date: "2026-05-29" },
        { name: "mFood V7.2.5 Launch", date: "2026-06-15" }
    ]
};

// ── 开发人员角色映射表 ──
// 键为人员姓名，值为角色标识（Backend/Frontend/Mobile/Tester/Product/UI/PM/Ops）
export const DEVELOPER_ROLES_MAP = {
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

// ── 角色元数据（名称与徽章样式） ──
export const roleMeta = {
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

// ── 流转检查清单规则 ──
// 按状态匹配对应的检查项，_default 为兜底规则
export const CHECKLIST_RULES = {
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
