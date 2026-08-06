/**
 * 评论 IndexedDB 存储模块
 * 使用原生 IndexedDB API + Promise 封装，存储工作项评论数据
 * 数据库名: devops_dashboard, Object Store: comments, keyPath: itemId
 */

const DB_NAME = 'devops_dashboard';
const DB_VERSION = 1;
const STORE_NAME = 'comments';

/** IndexedDB 数据库实例引用 */
let _db = null;

/**
 * 初始化 IndexedDB 数据库
 * 打开/创建 devops_dashboard 数据库，创建 comments Object Store
 * @returns {Promise<IDBDatabase>} 数据库实例
 */
export function initCommentsDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn('IndexedDB not supported, falling back to localStorage');
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        // 数据库升级回调（首次创建或版本变更时触发）
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'itemId' });
            }
        };

        request.onsuccess = (event) => {
            _db = event.target.result;
            resolve(_db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB init failed:', event.target.error);
            resolve(null); // 降级为 localStorage
        };
    });
}

/**
 * 从 IndexedDB 加载评论列表
 * @param {string} itemId - 工作项 ID
 * @returns {Promise<Array>} 评论数组，失败时返回空数组
 */
export function loadCommentsDB(itemId) {
    return new Promise((resolve) => {
        // 降级：IndexedDB 不可用时回退到 localStorage
        if (!_db) {
            try {
                resolve(JSON.parse(localStorage.getItem('devops_comments_' + itemId) || '[]'));
            } catch {
                resolve([]);
            }
            return;
        }

        const tx = _db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(itemId);

        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? (result.comments || []) : []);
        };

        request.onerror = () => {
            console.error('loadCommentsDB failed for', itemId);
            resolve([]);
        };
    });
}

/**
 * 保存评论到 IndexedDB
 * 先读取已有评论，追加新评论后写回
 * @param {string} itemId - 工作项 ID
 * @param {string} text - 评论内容
 * @returns {Promise<void>}
 */
export function saveCommentDB(itemId, text) {
    return new Promise((resolve, reject) => {
        // 降级：IndexedDB 不可用时回退到 localStorage
        if (!_db) {
            try {
                const comments = JSON.parse(localStorage.getItem('devops_comments_' + itemId) || '[]');
                comments.push({ text, author: '我', time: new Date().toLocaleString('zh-CN') });
                localStorage.setItem('devops_comments_' + itemId, JSON.stringify(comments));
                resolve();
            } catch (e) {
                reject(e);
            }
            return;
        }

        const tx = _db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // 先读取已有评论
        const getRequest = store.get(itemId);
        getRequest.onsuccess = () => {
            const existing = getRequest.result;
            const comments = existing ? (existing.comments || []) : [];
            comments.push({ text, author: '我', time: new Date().toLocaleString('zh-CN') });

            const putRequest = store.put({ itemId, comments });
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

/**
 * 从 localStorage 迁移评论数据到 IndexedDB
 * 扫描所有 devops_comments_* 前缀的 key，逐条迁移
 * 迁移完成后设置 devops_comments_migrated = true 标记
 * @returns {Promise<void>}
 */
export async function migrateCommentsFromLocalStorage() {
    // 检查是否已迁移
    if (localStorage.getItem('devops_comments_migrated') === 'true') return;
    if (!_db) return;

    // 扫描所有 devops_comments_* key（排除迁移标记本身）
    const keys = Object.keys(localStorage).filter(
        k => k.startsWith('devops_comments_') && k !== 'devops_comments_migrated'
    );

    if (keys.length === 0) {
        localStorage.setItem('devops_comments_migrated', 'true');
        return;
    }

    let migratedCount = 0;
    for (const key of keys) {
        const itemId = key.replace('devops_comments_', '');
        try {
            const comments = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(comments) && comments.length > 0) {
                await new Promise((resolve, reject) => {
                    const tx = _db.transaction(STORE_NAME, 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    const putRequest = store.put({
                        itemId,
                        comments,
                        migratedAt: Date.now()
                    });
                    putRequest.onsuccess = () => resolve();
                    putRequest.onerror = () => reject(putRequest.error);
                });
                migratedCount++;
            }
        } catch (e) {
            console.warn('Failed to migrate comments for', itemId, e);
        }
    }

    localStorage.setItem('devops_comments_migrated', 'true');
    console.log(`Comments migration completed: ${migratedCount} items migrated from localStorage to IndexedDB`);
}
