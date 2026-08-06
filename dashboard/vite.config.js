/**
 * Vite 构建配置
 * - base: './' 确保构建产物使用相对路径，适配 GitHub Pages 部署
 * - build.target: 'es2020' 支持现代浏览器 ES Module 特性
 * - build.outDir: 'dist' 构建输出目录
 * - copy-static-assets 插件：构建后将 data/ 和配置文件复制到 dist/
 */
import { defineConfig } from 'vite';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        target: 'es2020',
        assetsInclude: ['**/*.json'],
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]'
            }
        }
    },
    server: {
        host: '0.0.0.0',
        port: 5173
    },
    plugins: [
        {
            name: 'copy-static-assets',
            closeBundle() {
                const root = process.cwd();
                const distData = join(root, 'dist', 'data');
                mkdirSync(distData, { recursive: true });

                // 复制数据文件到 dist/data/
                const dataFile = join(root, 'data', 'projects_data.json');
                if (existsSync(dataFile)) {
                    cpSync(dataFile, join(distData, 'projects_data.json'));
                }

                // 复制认证配置文件和关键路径配置到 dist/
                ['auth.config.json', 'auth.config.example.json', 'critical_path_config.json'].forEach(f => {
                    const src = join(root, f);
                    if (existsSync(src)) {
                        cpSync(src, join(root, 'dist', f));
                    }
                });
            }
        }
    ]
});
