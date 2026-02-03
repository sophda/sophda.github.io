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
    }

    function closePanel() {
        const panel = document.getElementById('md-panel');
        if (!panel) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
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
                contentEl.innerHTML = safe;

                // Fix relative image URLs inside rendered markdown
                if (baseRaw) {
                    const imgs = contentEl.querySelectorAll('img');
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
                contentEl.innerHTML = safe;
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
    }

    window.openMdFolder = async function(link, title) {
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
            alert('获取文件列表失败，请检查链接或网络。');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('md-panel-close');
        if (closeBtn) closeBtn.addEventListener('click', closePanel);
    });

})();
