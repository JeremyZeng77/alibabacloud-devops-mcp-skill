/**
 * 虚拟滚动工具模块
 * 提供固定行高表格/列表的虚拟滚动能力，支持大数据量下的流畅渲染
 * 兼容 <tbody> 表格模式和 <div>/<ul> 容器模式
 */

/**
 * 虚拟表格类
 * 通过仅渲染可视区域内的行来实现高性能滚动
 * 表格模式：使用 spacer <tr> 撑起总高度
 * 容器模式：使用 spacer <div> 撑起总高度
 */
export class VirtualTable {
    /**
     * 构造函数
     * @param {Object} options - 配置选项
     * @param {HTMLElement} options.container - 行容器 DOM 元素（tbody / div / ul）
     * @param {number} [options.rowHeight=44] - 固定行高（px）
     * @param {number} [options.bufferRows=5] - 上下缓冲行数
     * @param {Function} options.renderRow - 行渲染回调 (item, index) => HTMLElement
     * @param {HTMLElement} [options.scrollContainer] - 滚动容器（若与行容器不同）
     */
    constructor({ container, rowHeight = 44, bufferRows = 5, renderRow, scrollContainer }) {
        this.container = container;
        this.rowHeight = rowHeight;
        this.bufferRows = bufferRows;
        this.renderRow = renderRow;
        this.data = [];
        this.scrollTop = 0;
        this.visibleRange = { start: 0, end: 0 };
        this._rafId = null;
        this._scrollHandler = null;

        // 判断是否为表格模式（tbody 容器）
        this._isTable = container.tagName === 'TBODY';

        // 确定滚动容器
        // 表格模式：滚动容器为父级 .table-container
        // 容器模式：滚动容器为 container 自身
        if (scrollContainer) {
            this._scrollContainer = scrollContainer;
        } else if (this._isTable) {
            this._scrollContainer = container.closest('.table-container') || container.parentElement;
        } else {
            this._scrollContainer = container;
            container.classList.add('vt-scroll');
        }

        // 表格模式：检测列数并设置 thead sticky
        this._colspan = 1;
        if (this._isTable) {
            const table = container.closest('table');
            if (table) {
                const thead = table.querySelector('thead');
                if (thead) {
                    thead.style.position = 'sticky';
                    thead.style.top = '0';
                    thead.style.zIndex = '10';
                    thead.style.background = 'var(--bg-surface-solid, #111625)';
                    const firstRow = thead.querySelector('tr');
                    if (firstRow) {
                        this._colspan = firstRow.children.length;
                    }
                }
            }
            // 为表格容器添加滚动样式
            if (this._scrollContainer) {
                this._scrollContainer.classList.add('vt-scroll-table');
            }
        }

        this._init();
    }

    /**
     * 初始化：绑定滚动事件
     * @private
     */
    _init() {
        this._scrollHandler = () => {
            this.onScroll(this._scrollContainer.scrollTop);
        };
        this._scrollContainer.addEventListener('scroll', this._scrollHandler);
    }

    /**
     * 设置数据集并触发重新渲染
     * @param {Array} data - 数据数组
     */
    setData(data) {
        this.data = data || [];
        this.scrollTop = this._scrollContainer.scrollTop;
        this.render();
    }

    /**
     * 计算当前可视范围内的行索引
     * @returns {{start: number, end: number}} 可见行起始和结束索引
     * @private
     */
    _calculateVisibleRange() {
        const containerHeight = this._scrollContainer.clientHeight;
        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.bufferRows);
        const visibleCount = Math.ceil(containerHeight / this.rowHeight) + this.bufferRows * 2;
        const endIndex = Math.min(this.data.length, startIndex + visibleCount);
        return { start: startIndex, end: endIndex };
    }

    /**
     * 创建占位元素（撑起滚动空间）
     * @param {number} height - 占位高度（px）
     * @returns {HTMLElement} 占位元素
     * @private
     */
    _createSpacer(height) {
        if (this._isTable) {
            const tr = document.createElement('tr');
            tr.className = 'vt-spacer';
            tr.style.height = height + 'px';
            tr.innerHTML = `<td colspan="${this._colspan}" style="padding:0;border:none;height:${height}px;"></td>`;
            return tr;
        }
        const div = document.createElement('div');
        div.className = 'vt-spacer';
        div.style.height = height + 'px';
        return div;
    }

    /**
     * 渲染当前可视范围内的行
     * 使用 spacer + 可见行 + spacer 的结构撑起总高度
     */
    render() {
        const range = this._calculateVisibleRange();
        this.visibleRange = range;

        // 清空容器
        this.container.innerHTML = '';

        // 使用 DocumentFragment 批量插入，减少 reflow
        const fragment = document.createDocumentFragment();

        // 顶部占位
        if (range.start > 0) {
            fragment.appendChild(this._createSpacer(range.start * this.rowHeight));
        }

        // 可见行
        for (let i = range.start; i < range.end; i++) {
            const item = this.data[i];
            if (!item) continue;
            const el = this.renderRow(item, i);
            if (el) fragment.appendChild(el);
        }

        // 底部占位
        const remaining = this.data.length - range.end;
        if (remaining > 0) {
            fragment.appendChild(this._createSpacer(remaining * this.rowHeight));
        }

        this.container.appendChild(fragment);
    }

    /**
     * 滚动事件处理（rAF 节流）
     * @param {number} scrollTop - 当前滚动位置
     */
    onScroll(scrollTop) {
        this.scrollTop = scrollTop;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
        }
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this.render();
        });
    }

    /**
     * 滚动到指定行索引位置
     * @param {number} index - 目标行索引
     */
    scrollToIndex(index) {
        const clampedIndex = Math.max(0, Math.min(index, this.data.length - 1));
        this._scrollContainer.scrollTop = clampedIndex * this.rowHeight;
        this.scrollTop = this._scrollContainer.scrollTop;
        this.render();
    }

    /**
     * 获取当前渲染的行数（调试用）
     * @returns {number} 当前渲染行数
     */
    getRenderedCount() {
        return this.visibleRange.end - this.visibleRange.start;
    }

    /**
     * 销毁实例，清理事件监听和 DOM 引用
     */
    destroy() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._scrollHandler) {
            this._scrollContainer.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        this.container.innerHTML = '';
        this.data = [];
        this.container.classList.remove('vt-scroll');
    }
}
