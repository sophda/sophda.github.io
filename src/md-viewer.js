(function() {
    function parseRepoLink(url) {
        try {
            const a = document.createElement('a');
            a.href = url;
            const host = a.hostname.toLowerCase();
            const segs = a.pathname.split('/').filter(Boolean);
            if (host.includes('github.com')) {
                const owner = segs[0];
                const repo = segs[1];
                let branch, path = '';
                if (segs[2] === 'tree') {
                    branch = segs[3];
                    path = segs.slice(4).join('/');
                }
                return { provider: 'github', owner, repo, branch, path };
            }
            if (host.includes('gitee.com')) {
                const owner = segs[0];
                const repo = segs[1];
                let branch, path = '';
                if (segs[2] === 'tree') {
                    branch = segs[3];
                    path = segs.slice(4).join('/');
                }
                return { provider: 'gitee', owner, repo, branch, path };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async function fetchList(parsed) {
        const path = parsed.path || '';
        let api;
        if (parsed.provider === 'github') {
            api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}`;
            if (parsed.branch) api += `?ref=${parsed.branch}`;
        } else if (parsed.provider === 'gitee') {
            // For Gitee: use CORS proxy to avoid CORS issues on GitHub Pages
            api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}`;
            if (parsed.branch) api += `?ref=${parsed.branch}`;
            // Convert gitee link to github if they have a mirror, otherwise use proxy
            // For now, suggest the user to use GitHub mirror instead
            throw new Error('Gitee 源在 GitHub Pages 上存在 CORS 问题。请改用 GitHub 仓库，或将 Markdown 文件本地化到项目中。');
        }
        const res = await fetch(api);
        if (!res.ok) throw new Error('Failed to fetch directory list: ' + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        const files = data
            .filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.md'))
            .map(item => ({ name: item.name, download_url: item.download_url, path: item.path, size: item.size || null }));
        return files;
    }

    function openPanel() {
        const panel = document.getElementById('md-panel');
        if (!panel) return;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closePanel() {
        const panel = document.getElementById('md-panel');
        if (!panel) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        
        // Restore file list visibility
        const mdList = document.querySelector('.md-list');
        if (mdList) mdList.style.display = '';
    }

    async function loadAndRenderFile(url, parsed, baseRaw, fileSize) {
        const contentEl = document.querySelector('.md-content');
        const controller = new AbortController();
        const signal = controller.signal;

        // UI: progress + cancel
        contentEl.innerHTML = `
            <div class="md-progress">
                <div class="progress-label">加载中...</div>
                <div class="progress"><div class="progress-bar" style="width:0%"></div></div>
                <div style="margin-top:8px;"><button class="md-cancel-btn">取消</button></div>
            </div>
        `;
        const progressBar = contentEl.querySelector('.progress-bar');
        const cancelBtn = contentEl.querySelector('.md-cancel-btn');
        let aborted = false;
        cancelBtn.addEventListener('click', () => {
            aborted = true;
            controller.abort();
            contentEl.innerHTML = '<p>已取消。</p>';
        });

        try {
            let res = await fetch(url, { signal });
            if (!res.ok) {
                // try branch fallbacks for github when raw url failed
                if (parsed && parsed.provider === 'github') {
                    const altBranches = ['main', 'master'];
                    let success = false;
                    for (const b of altBranches) {
                        const alt = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${b}/${parsed.path ? parsed.path + '/' : ''}${url.split('/').pop()}`;
                        try {
                            const r2 = await fetch(alt, { signal });
                            if (r2.ok) { res = r2; success = true; url = alt; break; }
                        } catch (e) {}
                    }
                    if (!success) throw new Error('fetch failed ' + res.status);
                } else {
                    throw new Error('fetch failed ' + res.status);
                }
            }

            // streaming read for progress
            const contentLength = res.headers.get('Content-Length') || fileSize || null;
            if (res.body && typeof res.body.getReader === 'function') {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let received = 0;
                let chunks = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    received += value.length;
                    chunks += decoder.decode(value, { stream: true });
                    if (contentLength && progressBar) {
                        const pct = Math.min(100, Math.round((received / contentLength) * 100));
                        progressBar.style.width = pct + '%';
                    } else if (progressBar) {
                        // indeterminate progress growth
                        progressBar.style.width = Math.min(96, (progressBar._w || 0) + 4) + '%';
                        progressBar._w = parseInt(progressBar.style.width,10);
                    }
                    if (aborted) throw new Error('aborted');
                }
                chunks += decoder.decode();
                const txt = chunks;
                const html = window.marked ? window.marked.parse(txt) : txt;
                const safe = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
                const wrapper = document.createElement('div');
                wrapper.className = 'md-content-wrapper';
                wrapper.innerHTML = safe;
                contentEl.innerHTML = '';
                contentEl.appendChild(wrapper);

                generateRenderTOC(wrapper);

                // Fix relative image URLs inside rendered markdown
                if (baseRaw) {
                    const imgs = wrapper.querySelectorAll('img');
                    imgs.forEach(img => {
                        const src = img.getAttribute('src') || '';
                        if (!src.match(/^https?:|^data:/i)) {
                            try {
                                const resolved = new URL(src, baseRaw).toString();
                                img.src = resolved;
                            } catch (e) {}
                        }
                    });
                }
            } else {
                // fallback simple text grab
                const txt = await res.text();
                const html = window.marked ? window.marked.parse(txt) : txt;
                const safe = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
                const wrapper = document.createElement('div');
                wrapper.className = 'md-content-wrapper';
                wrapper.innerHTML = safe;
                contentEl.innerHTML = '';
                contentEl.appendChild(wrapper);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                // already handled
                return;
            }
            console.error(e);
            contentEl.innerHTML = `<p>加载失败：${e.message}</p><div style="margin-top:8px;"><button class="md-retry-btn">重试</button></div>`;
            const retryBtn = contentEl.querySelector('.md-retry-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => {
                loadAndRenderFile(url, parsed, baseRaw, fileSize);
            });
        }
    }

    function buildRawUrl(file, parsed) {
        if (file.download_url) return file.download_url;
        // fallback constructions
        if (parsed.provider === 'github') {
            const branch = parsed.branch || '';
            return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${file.path}`.replace(/\/\/+$/, '');
        }
        // Gitee is no longer supported due to CORS limitations on GitHub Pages
        return file.path;
    }

    function renderList(files, parsed) {
        const list = document.querySelector('#md-panel .md-list ul');
        const title = document.getElementById('md-panel-title');
        const contentEl = document.querySelector('.md-content');
        list.innerHTML = '';
        contentEl.innerHTML = '<p>请选择左侧的 Markdown 文件以预览。</p>';
        if (title) title.textContent = (parsed && parsed.path) ? parsed.path : 'Files';
            files.forEach(file => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
                a.textContent = file.name + (file.size ? ` (${Math.round(file.size/1024)} KB)` : '');
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const url = buildRawUrl(file, parsed);
                // determine base raw URL for resolving relative assets
                let baseRaw = null;
                if (file.download_url) {
                    baseRaw = file.download_url.replace(/[^/]+$/,'');
                } else if (parsed && parsed.provider) {
                    // fallback base construction
                    if (parsed.provider === 'github') {
                        const branch = parsed.branch || 'master';
                        const dir = parsed.path ? parsed.path + '/' : '';
                        baseRaw = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${dir}`;

                    }
                }
                    // If file is large, stream with progress and allow cancel
                    const size = file.size || null;
                    const LARGE_THRESHOLD = 300 * 1024; // 300KB
                    if (size && size > LARGE_THRESHOLD) {
                        if (!confirm(`文件较大 (${Math.round(size/1024)} KB)，继续下载并渲染吗？`)) return;
                    }
                    loadAndRenderFile(url, parsed, baseRaw, size);
            });
            li.appendChild(a);
            list.appendChild(li);
        });
        openPanel();

        if (files && files.length > 0) {
            const firstLink = list.querySelector('a');
            if (firstLink) {
                firstLink.click(); // 模拟点击第一个链接
            }
        }
    }

    function isLocalPath(link) {
        return link && !link.startsWith('http://') && !link.startsWith('https://');
    }

    

    function generateTOC(wrapper) {
        const mdList = document.querySelector('.md-list');
        const ul = mdList.querySelector('ul');
        const panelTitle = document.getElementById('md-panel-title');
        
        // 更改侧边栏标题
        if (panelTitle) panelTitle.textContent = '目录大纲';
        ul.innerHTML = ''; // 清空现有的列表
        
        // 获取所有标题元素
        const headings = wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) {
            ul.innerHTML = '<li style="padding: 8px 10px; color: #888; font-size: 0.9em;">本文暂无目录</li>';
        } else {
            headings.forEach((h, index) => {
                // 给标题动态添加唯一 ID
                if (!h.id) h.id = 'md-heading-' + index;
                
                const li = document.createElement('li');
                const level = parseInt(h.tagName.substring(1));
                // 根据标题级别计算左侧缩进 (H1 不缩进，H2 缩进 12px，以此类推)
                li.style.paddingLeft = ((level - 1) * 12) + 'px';
                
                const a = document.createElement('a');
                a.href = '#' + h.id;
                a.textContent = h.textContent;
                a.title = h.textContent; // 鼠标悬停显示完整标题
                
                // 点击目录时平滑滚动到对应标题
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                
                li.appendChild(a);
                ul.appendChild(li);
            });
        }
        
        // 确保左侧面板是显示状态
        if (mdList) mdList.style.display = 'block';
    }




function generateRenderTOC(wrapper) {
    const mdList = document.querySelector('.md-list');
    if (!mdList) return;

    // --- 1. 设置侧边栏宽度和布局模式 ---
    // 改为 flex 垂直布局，确保大标题在顶部，内容在下方撑满
    mdList.style.width = '480px'; 
    mdList.style.maxWidth = '50%';
    mdList.style.display = 'flex';
    mdList.style.flexDirection = 'column';

    // 统一顶部的大标题
    const panelTitle = document.getElementById('md-panel-title');
    if (panelTitle && panelTitle.textContent !== '文档概览') {
        panelTitle.textContent = '文档概览';
        panelTitle.style.marginBottom = '15px';
    }

    // --- 2. 查找或创建并排的双列容器 ---
    let columnsWrapper = document.getElementById('md-toc-columns-wrapper');
    if (!columnsWrapper) {
        columnsWrapper = document.createElement('div');
        columnsWrapper.id = 'md-toc-columns-wrapper';
        // 关键所在：水平 Flex 布局，并让其占据下方所有可用高度
        columnsWrapper.style.display = 'flex';
        columnsWrapper.style.flexDirection = 'row';
        columnsWrapper.style.gap = '15px';
        columnsWrapper.style.alignItems = 'flex-start';
        columnsWrapper.style.flex = '1'; 
        columnsWrapper.style.overflow = 'hidden'; 

        // 左列：用来放“文件列表”
        const fileListCol = document.createElement('div');
        fileListCol.id = 'md-file-list-col';
        fileListCol.style.flex = '1';
        fileListCol.style.overflowY = 'auto'; // 内容超长时允许左边独立滚动
        fileListCol.style.height = '100%';
        
        // 【核心修复】找到你原本存放文件的那个 <ul>，并把它装进左列里面
        const originalUl = mdList.querySelector('ul:not(.toc-list)');
        if (originalUl) {
            fileListCol.appendChild(originalUl);
        }

        // 右列：用来放“目录大纲”
        const tocCol = document.createElement('div');
        tocCol.id = 'md-toc-container';
        tocCol.style.flex = '1';
        tocCol.style.overflowY = 'auto'; // 内容超长时允许右边独立滚动
        tocCol.style.height = '100%';
        tocCol.style.borderLeft = '1px solid rgba(0,0,0,0.08)'; // 中间加一道浅色的分割线
        tocCol.style.paddingLeft = '15px';

        tocCol.innerHTML = '<h3 style="margin-top:0; font-size:1em; color:#555;">目录大纲</h3><ul class="toc-list" style="margin: 0; padding: 0; list-style: none;"></ul>';

        // 组装并追加到侧边栏
        columnsWrapper.appendChild(fileListCol);
        columnsWrapper.appendChild(tocCol);
        mdList.appendChild(columnsWrapper);
    }

    // --- 3. 填充右侧的目录内容 ---
    const tocUl = document.querySelector('.toc-list');
    if (tocUl) {
        tocUl.innerHTML = ''; // 清空旧的目录

        const headings = wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) {
            tocUl.innerHTML = '<li style="padding: 8px 10px; color: #888; font-size: 0.9em; font-style: italic;">本文暂无目录</li>';
        } else {
            headings.forEach((h, index) => {
                if (!h.id) h.id = 'md-heading-' + index;

                const li = document.createElement('li');
                li.style.padding = '4px 8px';
                
                const level = parseInt(h.tagName.substring(1));
                const indent = Math.max(0, (level - 2) * 12); 
                li.style.paddingLeft = (8 + indent) + 'px';

                const a = document.createElement('a');
                a.href = '#' + h.id;
                a.textContent = h.textContent;
                a.title = h.textContent; 
                a.style.color = '#444'; 
                a.style.textDecoration = 'none';
                a.style.fontSize = '0.95em';
                a.style.display = 'block';

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });

                // 悬停交互颜色
                a.onmouseover = function() { this.style.color = '#337ab7'; }
                a.onmouseout = function() { this.style.color = '#444'; }

                li.appendChild(a);
                tocUl.appendChild(li);
            });
        }
    }

    // 确保显示
    mdList.style.display = 'flex';
}






    async function loadLocalMdFile(filePath, title) {
        const contentEl = document.querySelector('.md-content');
        const panel = document.getElementById('md-panel');
        const panelTitle = document.getElementById('md-panel-title');
        
        contentEl.innerHTML = `
            <div class="md-progress">
                <div class="progress-label">加载中...</div>
                <div class="progress"><div class="progress-bar" style="width:0%"></div></div>
                <div style="margin-top:8px;"><button class="md-cancel-btn">取消</button></div>
            </div>
        `;
        const progressBar = contentEl.querySelector('.progress-bar');
        const cancelBtn = contentEl.querySelector('.md-cancel-btn');
        const controller = new AbortController();
        let aborted = false;
        
        cancelBtn.addEventListener('click', () => {
            aborted = true;
            controller.abort();
            contentEl.innerHTML = '<p>已取消。</p>';
        });

        try {
            const res = await fetch(filePath, { signal: controller.signal });
            if (!res.ok) {
                throw new Error(`Failed to fetch file: ${res.status}`);
            }

            const txt = await res.text();
            const html = window.marked ? window.marked.parse(txt) : txt;
            const safe = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
            const wrapper = document.createElement('div');
            wrapper.className = 'md-content-wrapper';
            wrapper.innerHTML = safe;
            contentEl.innerHTML = '';
            contentEl.appendChild(wrapper);

            // Fix relative image URLs for local files
            const baseUrl = filePath.substring(0, filePath.lastIndexOf('/') + 1);
            const imgs = wrapper.querySelectorAll('img');
            imgs.forEach(img => {
                const src = img.getAttribute('src') || '';
                if (!src.match(/^https?:|^data:|^\//i)) {
                    try {
                        const resolved = new URL(src, window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1) + baseUrl).toString();
                        img.src = resolved;
                    } catch (e) {}
                }
            });

            // Update panel title
            // if (panelTitle) panelTitle.textContent = title || 'Markdown';
            // // Hide the file list for single file view
            // const mdList = document.querySelector('.md-list');
            // if (mdList) mdList.style.display = 'none';
            generateTOC(wrapper);
            openPanel();
        } catch (e) {
            if (e.name === 'AbortError') {
                return;
            }
            console.error(e);
            contentEl.innerHTML = `<p>加载失败：${e.message}</p><div style="margin-top:8px;"><button class="md-retry-btn">重试</button></div>`;
            const retryBtn = contentEl.querySelector('.md-retry-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => {
                loadLocalMdFile(filePath, title);
            });
        }
    }

    window.openMdFolder = async function(link, title) {
        // Handle local file paths
        if (isLocalPath(link)) {
            // If it's a .md file, load it directly
            if (link.endsWith('.md')) {
                await loadLocalMdFile(link, title);
            } else {
                // If it's a directory, try to list md files from it
                try {
                    const res = await fetch(link);
                    if (!res.ok) throw new Error('Failed to fetch directory');
                    // For local directories, we can't list files directly
                    // Show a message or try to load an index.md if it exists
                    alert('本地目录不支持列表视图，请改用本地 .md 文件路径');
                } catch (e) {
                    console.error(e);
                    alert('无法加载本地文件或目录');
                }
            }
            return;
        }
        
        const parsed = parseRepoLink(link);
        if (!parsed) {
            // fallback: open in new tab
            window.open(link, '_blank');
            return;
        }
        try {
            const files = await fetchList(parsed);
            if (!files || files.length === 0) {
                alert('在该路径下未找到 Markdown 文件');
                return;
            }
            renderList(files, parsed);
        } catch (e) {
            console.error(e);
            alert('获取目录失败，可能触发了 GitHub API 频次限制。');
            // window.open(link, '_blank');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('md-panel-close');
        if (closeBtn) closeBtn.addEventListener('click', closePanel);
    });

})();
