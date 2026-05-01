(function() {
    const scriptSrc = document.currentScript.src;
    const STREET_ROOT = scriptSrc.replace('/js/street-v1.js', '');
    
    // Make STREET_ROOT available globally for live-editor.js
    window.STREET_ROOT = STREET_ROOT;

    // NOTE: All live editor UI and edit-related logic must live in builder/live-editor.js.
    // Do not add live editor handlers, dropdowns, or section insertion code in street-v1.js.
    // street-v1.js should only initialize content, toggle live-update-mode, and defer editor behavior.

    const v = new Date().getTime();
    const INFRA_URL = `${STREET_ROOT}/street-infra.json?v=${v}`;
    const REGISTRY_URL = `${STREET_ROOT}/registry.json?v=${v}`;

    const urlParams = new URLSearchParams(window.location.search);
    const legacyPreviewMode = urlParams.get('preview') === '1';
    const legacyPreviewHouseId = urlParams.get('house_id');
    const legacyPreviewUuid = urlParams.get('uuid');

    const PREVIEW_JSON = window.PREVIEW_JSON || null;
    let PREVIEW_META = window.PREVIEW_META || null;
    if (!PREVIEW_META && legacyPreviewMode && legacyPreviewHouseId && legacyPreviewUuid) {
        PREVIEW_META = {
            house_id: legacyPreviewHouseId,
            uuid: legacyPreviewUuid,
            created_at: urlParams.get('created_at') || ''
        };
    }
    const previewHouseId = (PREVIEW_META && PREVIEW_META.house_id) || legacyPreviewHouseId || '';
    const previewCreatedAt = (PREVIEW_META && PREVIEW_META.created_at) || '';
    const isPreviewMode = !!(window.PREVIEW_MODE || PREVIEW_META || legacyPreviewMode);
    const PAGE_ID_QUERY_KEY = 'page_id';

    // In light deploy mode, use window.HOUSE_JSON_URL if available
    const HOUSE_JSON_URL = window.HOUSE_JSON_URL || `./house.json?v=${v}`;
    const CONTENT_URL = HOUSE_JSON_URL.includes('?') ? HOUSE_JSON_URL : `${HOUSE_JSON_URL}?v=${v}`;

    let contentPromise;
    if (PREVIEW_JSON) {
        console.log('PREVIEW_JSON detected');
        contentPromise = Promise.resolve(PREVIEW_JSON);
    } else if (legacyPreviewMode && legacyPreviewHouseId && legacyPreviewUuid) {
        console.log('Legacy preview mode, fetching by house_id + uuid:', legacyPreviewHouseId, legacyPreviewUuid);
        contentPromise = fetch(`${STREET_ROOT}/host/ajax_get_version_json.php?house_id=${encodeURIComponent(legacyPreviewHouseId)}&uuid=${encodeURIComponent(legacyPreviewUuid)}`)
            .then(res => {
                console.log('ajax_get_version_json status', res.status);
                return res.json();
            })
            .then(data => {
                console.log('ajax_get_version_json response', data);
                if (!data.success) throw new Error(data.error || 'Preview version không tồn tại');
                return JSON.parse(data.house_json);
            });
    } else {
        console.log('Normal mode, fetching content URL', CONTENT_URL);
        contentPromise = fetch(CONTENT_URL)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load house.json: ${res.status}`);  
                return res.json();
            })
            .catch(err => {
                console.error('Error loading house.json:', err);
                throw err;
            });
    }

    if (isPreviewMode) {
        const previewHouse = PREVIEW_META?.house_id || legacyPreviewHouseId || '';
        const createdAt = PREVIEW_META?.created_at || '';
        const previewDate = createdAt.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1');

        document.title = `Xem trước ${previewHouse}`;

        if (!document.getElementById('st-preview-badge')) {
            const previewBadge = document.createElement('div');
            previewBadge.id = 'st-preview-badge';
            previewBadge.style.cssText = 'position:fixed;bottom:12px;right:12px;background:rgba(255,234,175,0.95);color:#846404;z-index:100020;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 5px 18px rgba(0,0,0,0.12);pointer-events:none;';
            previewBadge.innerText = `Xem trước web` + (previewDate ? ` ngày ${previewDate}` : '');
            document.body.appendChild(previewBadge);
        }
    }

    let startX = 0, startY = 0;
    const THRESHOLD = 70;
    const VERTICAL_THRESHOLD = 80;

    let currentHouse = null, currentInfra = null, currentRegistry = null, currentAccent = null, availableBuilders = [];
    let liveUpdateMode = false;

    const updateHeaderEditButtonVisibility = (enabled) => {
        const headerEditBtn = document.querySelector('.st-menu-edit-btn');
        if (headerEditBtn) {
            headerEditBtn.style.display = enabled ? 'grid' : 'none';
        }
    };

    let _stSavedBodyPaddingRight = '';
    let _stBodyScrollLocked = false;
    const getScrollbarWidth = () => window.innerWidth - document.documentElement.clientWidth;
    const lockBodyScroll = () => {
        if (_stBodyScrollLocked) return;
        const scrollbarWidth = getScrollbarWidth();
        if (scrollbarWidth > 0) {
            _stSavedBodyPaddingRight = document.body.style.paddingRight || '';
            const computedPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
            document.body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
        }
        document.body.style.overflow = 'hidden';
        _stBodyScrollLocked = true;
    };
    const unlockBodyScroll = () => {
        if (!_stBodyScrollLocked) return;
        document.body.style.overflow = '';
        document.body.style.paddingRight = _stSavedBodyPaddingRight;
        _stBodyScrollLocked = false;
    };

    const checkHostLoginState = async () => {
        let result = false;
        if (typeof window.checkHostSession === 'function') {
            try {
                result = !!(await window.checkHostSession());
            } catch (err) {
                console.error('Lỗi kiểm tra đăng nhập:', err);
                result = false;
            }
            window.__STREET_HOST_LOGGED_IN = result;
            return result;
        }

        try {
            const response = await fetch(`${STREET_ROOT}/host/api_check_session.php`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
            if (!response.ok) {
                window.__STREET_HOST_LOGGED_IN = false;
                return false;
            }
            const json = await response.json();
            result = json.logged_in === true;
            window.__STREET_HOST_LOGGED_IN = result;
            return result;
        } catch (err) {
            console.error('Lỗi kiểm tra đăng nhập mặc định:', err);
            window.__STREET_HOST_LOGGED_IN = false;
            return false;
        }
    };

    const HOST_AUTH_CHANGED_EVENT = 'st-host-auth-changed';

    const emitHostAuthChanged = (loggedIn) => {
        window.dispatchEvent(new CustomEvent(HOST_AUTH_CHANGED_EVENT, {
            detail: { loggedIn: loggedIn === true }
        }));
    };

    const updateAddButtonVisibility = async () => {
        const addBtn = document.getElementById('st-add-button');
        const editToggleBtn = document.getElementById('st-edit-toggle-btn');
        const editToggleRow = document.getElementById('st-menu-edit-row');
        if (!addBtn && !editToggleBtn && !editToggleRow) return;
        const isLoggedIn = await checkHostLoginState();
        const menuBarVisible = document.getElementById('st-menu')?.style.display !== 'none';
        if (addBtn) addBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
        if (editToggleBtn) editToggleBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
        if (editToggleRow) editToggleRow.style.display = (isLoggedIn && menuBarVisible) ? 'flex' : 'none';
    };

    const setLiveUpdateMode = (enabled) => {
        liveUpdateMode = enabled;
        document.body.classList.toggle('live-update-mode', enabled);
        const editToggleRow = document.getElementById('st-menu-edit-row');
        if (editToggleRow) editToggleRow.classList.toggle('active', enabled);
        updateHeaderEditButtonVisibility(enabled);
        const editToggleBtn = document.getElementById('st-edit-toggle-btn');
        if (editToggleBtn) editToggleBtn.classList.toggle('active', enabled);
        if (typeof window.setInlineEditMode === 'function') {
            window.setInlineEditMode(enabled, currentHouse);
        }
        if (currentHouse) {
            renderHouse(currentInfra, currentHouse, currentRegistry);
        }
        if (enabled) {
            loadLiveEditorScript().catch(() => {});
        }
    };

    const toggleEditModeFromRow = (event) => {
        if (event) event.stopPropagation();
        setLiveUpdateMode(!liveUpdateMode);
        if (typeof updateFloatingEditButtonState === 'function') {
            updateFloatingEditButtonState();
        }
        if (liveUpdateMode) {
            loadLiveEditorScript().then(() => {
                if (typeof window.initLiveEditorSilent === 'function') {
                    window.initLiveEditorSilent();
                } else if (typeof window.initLiveEditor === 'function') {
                    window.initLiveEditor();
                    const toolbar = document.getElementById('st-web-builder-toolbar');
                    if (toolbar) toolbar.style.display = 'none';
                }
            }).catch(() => {});
        }
    };

    // Dropdown user và các hàm liên quan đã chuyển sang js/user-dropdown.js
    // toggleUserPopupMenu / closeUserPopupMenu / ensureUserPopupMenu → window.*

    // Tải builder modules (store → style → menu → editor → ui) thay cho live-editor.js monolith
    const loadLiveEditorScript = () => {
        if (typeof window.loadBuilderModules === 'function') {
            return window.loadBuilderModules();
        }
        // fallback: tự load nếu user-dropdown.js chưa được include
        if (window._streetBuilderModulesLoaded) return Promise.resolve();
        if (window._streetBuilderModulesLoading) return window._streetBuilderModulesLoading;
        const loadScript = (src) => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Không tải được: ' + src));
            document.head.appendChild(script);
        });
        window._streetBuilderModulesLoading = loadScript(`${STREET_ROOT}/builder/store.js`)
            .then(() => loadScript(`${STREET_ROOT}/builder/style.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/menu.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/editor.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-header.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-body.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-footer.js`))
            .then(() => { window._streetBuilderModulesLoaded = true; });
        return window._streetBuilderModulesLoading;
    };

    const checkHostSessionForUserMenu = async () => {
        try {
            if (typeof window.checkServerSessionLive === 'function') {
                return await window.checkServerSessionLive();
            }
            const root = (window.APP_ROOT || window.STREET_ROOT || '').replace(/\/$/, '');
            const url = root ? `${root}/host/api_check_session.php` : '/host/api_check_session.php';
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
            const result = await response.json();
            return result.logged_in === true;
        } catch (err) {
            console.error('Không thể kiểm tra phiên host:', err);
            return false;
        }
    };

    const openHostLoginForUserMenu = async () => {
        if (typeof window.openHostLoginModal !== 'function') {
            try {
                await loadLiveEditorScript();
            } catch (err) {
                console.error('Không thể tải builder modules để mở popup đăng nhập:', err);
            }
        }
        if (typeof window.openHostLoginModal === 'function') {
            window.openHostLoginModal('menu');
        } else if (window.__LEUI && typeof window.__LEUI.openHostLoginModal === 'function') {
            window.__LEUI.openHostLoginModal('menu');
        } else {
            return false;
        }

        const startedAt = Date.now();
        const timeoutMs = 30000;
        const pollDelayMs = 500;

        return await new Promise((resolve) => {
            const poll = async () => {
                const isLoggedIn = await checkHostSessionForUserMenu();
                if (isLoggedIn) {
                    if (typeof window.closeHostLoginModal === 'function') {
                        window.closeHostLoginModal();
                    } else if (window.__LEUI && typeof window.__LEUI.closeHostLoginModal === 'function') {
                        window.__LEUI.closeHostLoginModal();
                    }
                    window.toggleUserPopupMenu?.();
                    resolve(true);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(false);
                    return;
                }

                window.setTimeout(poll, pollDelayMs);
            };

            poll();
        });
    };

    const openLiveEditor = (options = {}) => {
        const silent = !!options.silent;
        return loadLiveEditorScript().then(() => {
            if (silent) {
                if (typeof window.hideWebBuilderToolbar === 'function') {
                    window.hideWebBuilderToolbar();
                }
                if (typeof window.initLiveEditorSilent === 'function') {
                    window.initLiveEditorSilent();
                    return;
                }
            }
            if (typeof window.initLiveEditor === 'function') {
                window.initLiveEditor();
                return;
            }
            console.warn('initLiveEditor not available after live-editor.js load');
        }).catch(err => {
            console.error(err);
        });
    };

    const getHostHouseId = () => {
        if (currentHouse && currentHouse.house_id) return currentHouse.house_id;
        if (currentHouse && currentHouse.id) return currentHouse.id;
        return previewHouseId || '';
    };

    const ensureBootstrapIcons = () => {
        if (document.querySelector('link[href*="bootstrap-icons"]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    };
    ensureBootstrapIcons();

    const getPageIdFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get(PAGE_ID_QUERY_KEY) || '';
    };

    const syncPageIdToUrl = (pageId, replace = false) => {
        if (!pageId) return;
        const nextUrl = new URL(window.location.href);
        if (nextUrl.searchParams.get(PAGE_ID_QUERY_KEY) === pageId) return;
        nextUrl.searchParams.set(PAGE_ID_QUERY_KEY, pageId);
        const method = replace ? 'replaceState' : 'pushState';
        window.history[method]({}, '', nextUrl.toString());
    };

    // Inline edit logic is now handled in street/builder/live-editor.js

    // --- 1. Vẽ Mosaic SVG ---
    const drawMosaicSvgBase64 = (houseName) => {
        const g = ["#F5F5F5", "#EEEEEE", "#E0E0E0", "#D5D5D5"];
        const escapeSvg = (str) => str.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);
        const name = escapeSvg(houseName || "Cửa tiệm");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100"><rect width="100" height="100" fill="${g[0]}"/><rect x="0" y="0" width="40" height="40" fill="${g[1]}"/><rect x="40" y="0" width="60" height="30" fill="${g[2]}"/><rect x="0" y="40" width="30" height="60" fill="${g[2]}"/><rect x="30" y="30" width="70" height="70" fill="${g[3]}"/><text x="50" y="52" font-family="sans-serif" font-size="5" fill="#888" text-anchor="middle" font-weight="bold">${name}</text></svg>`.trim();
        return `data:image/svg+xml;base64,${btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)))}`;
    };

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return char;
        }
    });

    const FOOTER_ALLOWED_BLOCK_TYPES = ['contact', 'link', 'text', 'logo', 'social'];
    const FOOTER_MAX_COLUMNS = 3;
    const FOOTER_MAX_BLOCKS_PER_COLUMN = 4;
    const clampFooterColumns = (value) => {
        const numericValue = Number.parseInt(value, 10);
        if (!Number.isFinite(numericValue)) return 1;
        return Math.min(FOOTER_MAX_COLUMNS, Math.max(1, numericValue));
    };
    const normalizeFooterBlockType = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return FOOTER_ALLOWED_BLOCK_TYPES.includes(normalized) ? normalized : 'text';
    };
    const normalizeFooterLinks = (links) => {
        if (!Array.isArray(links)) return [];
        return links
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const label = String(entry.label || '').trim();
                const url = String(entry.url || '').trim();
                if (!label && !url) return null;
                return { label, url };
            })
            .filter(Boolean)
            .slice(0, 8);
    };
    const createFooterBlock = (type, overrides = {}) => ({
        id: overrides.id || `footer_${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        type,
        title: overrides.title || '',
        text: overrides.text || '',
        links: normalizeFooterLinks(overrides.links)
    });
    const createFooterPreset = (house, preset = '2col') => {
        const slogan = String(house?.store_info?.slogan || '').trim();
        const presetKey = ['1col', '2col', '3col'].includes(String(preset || '').trim().toLowerCase())
            ? String(preset || '').trim().toLowerCase()
            : '2col';
        if (presetKey === '1col') {
            return {
                preset: '1col',
                columns: 1,
                columnsData: [
                    { blocks: [
                        createFooterBlock('logo'),
                        createFooterBlock('contact', { title: 'Lien he' })
                    ] }
                ]
            };
        }
        if (presetKey === '3col') {
            return {
                preset: '3col',
                columns: 3,
                columnsData: [
                    { blocks: [createFooterBlock('logo')] },
                    { blocks: [createFooterBlock('contact', { title: 'Lien he' })] },
                    { blocks: [createFooterBlock('social', { title: 'Mang xa hoi' })] }
                ]
            };
        }
        return {
            preset: '2col',
            columns: 2,
            columnsData: [
                { blocks: [
                    createFooterBlock('logo'),
                    createFooterBlock('text', { title: 'Gioi thieu', text: slogan })
                ] },
                { blocks: [createFooterBlock('contact', { title: 'Lien he' })] }
            ]
        };
    };
    const normalizeFooterBlock = (block, house, fallbackType = 'text') => {
        const safeType = normalizeFooterBlockType(block?.type || fallbackType);
        const normalized = createFooterBlock(safeType, block || {});
        if (!normalized.title) {
            if (safeType === 'contact') normalized.title = 'Lien he';
            if (safeType === 'text') normalized.title = 'Gioi thieu';
            if (safeType === 'link') normalized.title = 'Lien ket';
            if (safeType === 'social') normalized.title = 'Mang xa hoi';
        }
        if (safeType === 'text' && !normalized.text) {
            normalized.text = String(house?.store_info?.slogan || '').trim();
        }
        return normalized;
    };
    const normalizeFooterSettings = (settings, house) => {
        const fallback = createFooterPreset(house, settings?.preset || '2col');
        const columnCount = clampFooterColumns(settings?.columns || fallback.columns);
        const sourceColumns = Array.isArray(settings?.columnsData) ? settings.columnsData : fallback.columnsData;
        const columnsData = Array.from({ length: columnCount }, (_, index) => {
            const sourceColumn = sourceColumns[index] || fallback.columnsData[index] || { blocks: [] };
            const sourceBlocks = Array.isArray(sourceColumn?.blocks) ? sourceColumn.blocks : [];
            return {
                blocks: sourceBlocks
                    .slice(0, FOOTER_MAX_BLOCKS_PER_COLUMN)
                    .map((block) => normalizeFooterBlock(block, house))
            };
        });
        return {
            preset: ['1col', '2col', '3col'].includes(String(settings?.preset || fallback.preset)) ? String(settings?.preset || fallback.preset) : fallback.preset,
            columns: columnCount,
            maxBlocksPerColumn: FOOTER_MAX_BLOCKS_PER_COLUMN,
            columnsData
        };
    };
    const normalizeFooterUrl = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return raw;
        return `https://${raw.replace(/^\/+/, '')}`;
    };
    const renderFooterLinks = (links, emptyText) => {
        if (!links.length) {
            return `<div class="st-footer-empty">${escapeHtml(emptyText)}</div>`;
        }
        return `<div class="st-footer-links">${links.map((entry) => {
            const label = entry.label || entry.url;
            const href = normalizeFooterUrl(entry.url || '');
            return `<a class="st-footer-link" href="${escapeHtml(href)}"${href && /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}</a>`;
        }).join('')}</div>`;
    };
    const renderFooterBlockMarkup = (block, house) => {
        const blockTitle = block.title ? `<div class="st-footer-block-title">${escapeHtml(block.title)}</div>` : '';
        if (block.type === 'logo') {
            const slogan = String(house?.store_info?.slogan || '').trim();
            return `
                <section class="st-footer-block st-footer-block-logo">
                    <div class="st-footer-brand">${escapeHtml(house?.store_info?.name || '')}</div>
                    ${slogan ? `<div class="st-footer-text">${escapeHtml(slogan)}</div>` : ''}
                </section>
            `;
        }
        if (block.type === 'contact') {
            const contact = house?.contact || {};
            const rows = [];
            if (contact.address) rows.push(`<div class="st-footer-contact-item"><b>🏠</b><span>${escapeHtml(contact.address)}</span></div>`);
            if (contact.phone) rows.push(`<div class="st-footer-contact-item"><b>📞</b><span>${escapeHtml(contact.phone)}</span></div>`);
            if (contact.email) rows.push(`<div class="st-footer-contact-item"><b>✉️</b><span>${escapeHtml(contact.email)}</span></div>`);
            if (contact.zalo) rows.push(`<div class="st-footer-contact-item"><b>💬</b><span>${escapeHtml(contact.zalo)}</span></div>`);
            return `
                <section class="st-footer-block st-footer-block-contact">
                    ${blockTitle}
                    <div class="st-footer-contact">${rows.length ? rows.join('') : '<div class="st-footer-empty">Thong tin lien he dang cap nhat.</div>'}</div>
                </section>
            `;
        }
        if (block.type === 'link') {
            return `
                <section class="st-footer-block st-footer-block-links">
                    ${blockTitle}
                    ${renderFooterLinks(block.links || [], 'Chua co lien ket.')}
                </section>
            `;
        }
        if (block.type === 'social') {
            return `
                <section class="st-footer-block st-footer-block-social">
                    ${blockTitle}
                    ${renderFooterLinks(block.links || [], 'Chua co mang xa hoi.')}
                </section>
            `;
        }
        return `
            <section class="st-footer-block st-footer-block-text">
                ${blockTitle}
                <div class="st-footer-text">${block.text ? escapeHtml(block.text) : 'Noi dung dang cap nhat.'}</div>
            </section>
        `;
    };
    const buildFooterMarkup = (house) => {
        const footerSettings = normalizeFooterSettings(house?.footer_settings, house || {});
        const copyrightText = house?.copyright || `© ${house?.store_info?.name || ''}`;
        const columnsHtml = footerSettings.columnsData.map((column, index) => `
            <div class="st-footer-column st-footer-column-${index + 1}">
                ${(column.blocks || []).map((block) => renderFooterBlockMarkup(block, house || {})).join('') || '<div class="st-footer-empty">Cot nay chua co noi dung.</div>'}
            </div>
        `).join('');
        return `<div class="st-footer-bg"><footer class="st-footer"><div class="st-footer-inner"><div class="st-footer-content st-footer-layout-${footerSettings.columns}">${columnsHtml}</div><div class="st-footer-copy">${escapeHtml(copyrightText)}</div></div></footer></div>`;
    };

    const getSectionText = (section) => {
        if (!section) return '';
        if (typeof section.content === 'string') return section.content;
        if (section.content && typeof section.content === 'object') return section.content.text || '';
        return '';
    };

    const createSectionId = () => {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `section_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    };

    const ensureSectionId = (section) => {
        if (!section) return section;
        if (!section.id) section.id = createSectionId();
        return section;
    };

    const normalizePageSectionIds = (page) => {
        if (!page || !Array.isArray(page.sections)) return page;
        page.sections.forEach(ensureSectionId);
        return page;
    };

    const sanitizeTextSectionHtml = (html) => {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'UL', 'OL', 'LI', 'P', 'DIV', 'SPAN']);

        const walk = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const tagName = child.tagName.toUpperCase();
                    if (!allowedTags.has(tagName)) {
                        const fragment = document.createDocumentFragment();
                        while (child.firstChild) fragment.appendChild(child.firstChild);
                        child.replaceWith(fragment);
                        return;
                    }
                    Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
                    walk(child);
                }
            });
        };

        walk(template.content);
        return template.innerHTML;
    };

    const getSectionTitle = (section) => {
        if (!section || typeof section.content !== 'object' || section.content === null) return '';
        return section.content.title || '';
    };

    const getSectionSettings = (section) => {
        if (!section) return { paddingTop: 20, paddingBottom: 20, background: '', textAlign: 'left' };
        if (!section.settings || typeof section.settings !== 'object') return { paddingTop: 20, paddingBottom: 20, background: '', textAlign: 'left' };
        return {
            paddingTop: typeof section.settings.paddingTop === 'number' ? section.settings.paddingTop : 20,
            paddingBottom: typeof section.settings.paddingBottom === 'number' ? section.settings.paddingBottom : 20,
            background: section.settings.background || '',
            textAlign: section.settings.textAlign || 'left'
        };
    };

    const buildSectionStyle = (section) => {
        const settings = getSectionSettings(section);
        const styles = [];
        if (typeof settings.paddingTop === 'number') styles.push(`padding-top:${settings.paddingTop}px`);
        if (typeof settings.paddingBottom === 'number') styles.push(`padding-bottom:${settings.paddingBottom}px`);
        if (settings.background) styles.push(`background:${settings.background}`);
        if (settings.textAlign) styles.push(`text-align:${settings.textAlign}`);
        return styles.join(';');
    };

    const getProductDataForSection = (section, house) => {
        if (section && section.product_ref && house && Array.isArray(house.product_pool)) {
            const product = house.product_pool.find(item => item.id === section.product_ref);
            if (product) return product;
        }
        return section;
    };

    const getProductLayoutVariant = (section) => {
        const variant = section?.layout?.variant;
        return ['horizontal', 'reversed', 'compact', 'highlight', 'minimal', 'banner'].includes(variant) ? variant : 'horizontal';
    };

    const getProductLayoutConfig = (section, options = {}) => {
        const variant = getProductLayoutVariant(section);
        if (variant === 'compact') {
            const grouped = !!options.compactGrouped;
            return {
                variant,
                rootStyle: grouped
                    ? `padding:16px;background:#fff;border-radius:20px;border:1px solid rgba(226,232,240,0.95);box-shadow:0 10px 24px rgba(15,23,42,0.08);width:100%;max-width:none;margin:0;height:100%;`
                    : 'padding:16px;width:100%;max-width:none;margin:0;',
                rowStyle: grouped
                    ? 'display:flex;flex-direction:column;gap:10px;align-items:stretch;justify-content:flex-start;width:100%;margin:0;height:100%;'
                    : 'display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;justify-content:space-between;width:100%;margin:0;',
                imageStyle: grouped
                    ? 'width:100%;aspect-ratio:4 / 3;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;'
                    : 'flex:0 0 152px;width:152px;min-width:120px;max-width:152px;aspect-ratio:4 / 3;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
                contentStyle: grouped
                    ? 'display:flex;flex-direction:column;gap:8px;min-width:0;justify-content:flex-start;'
                    : 'flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:8px;justify-content:center;',
                titleStyle: 'margin:0;font-size:1.02rem;color:#111827;line-height:1.25;',
                priceStyle: 'font-size:1.07rem;font-weight:600;color:#111827;',
                descriptionStyle: 'display:none;',
                actionsStyle: 'display:none;',
                showDescription: false,
                showActions: false
            };
        }

        if (variant === 'reversed') {
            return {
                variant,
                rootStyle: 'padding:24px;max-width:1040px;margin:0 auto;',
                rowStyle: 'display:flex;flex-wrap:wrap-reverse;flex-direction:row-reverse;gap:20px;align-items:flex-start;justify-content:space-between;',
                imageStyle: 'flex:1.15 1 360px;min-width:280px;aspect-ratio:4 / 3;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
                contentStyle: 'flex:0.95 1 320px;min-width:240px;display:flex;flex-direction:column;gap:14px;padding:4px 0;',
                titleStyle: 'margin:0;font-size:1rem;color:#111827;line-height:1.22;letter-spacing:-0.01em;',
                priceStyle: 'font-size:1.15rem;font-weight:600;color:#111827;',
                descriptionStyle: 'color:#475569;line-height:1.7;font-size:0.95rem;',
                actionsStyle: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;',
                imageFirst: false
            };
        }

        if (variant === 'highlight') {
            return {
                variant,
                rootStyle: 'padding:30px;max-width:1120px;margin:0 auto;',
                rowStyle: 'display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;justify-content:space-between;',
                imageStyle: 'flex:1.25 1 440px;min-width:300px;aspect-ratio:4 / 3;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
                contentStyle: 'flex:0.9 1 320px;min-width:250px;display:flex;flex-direction:column;gap:16px;padding:4px 0;',
                titleStyle: 'margin:0;font-size:1rem;color:#111827;line-height:1.22;letter-spacing:-0.01em;',
                priceStyle: 'font-size:1.15rem;font-weight:600;color:#111827;',
                descriptionStyle: 'color:#334155;line-height:1.75;font-size:0.95rem;',
                actionsStyle: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;'
            };
        }

        if (variant === 'banner') {
            return {
                variant,
                rootStyle: 'padding:20px;max-width:1040px;margin:0 auto;',
                rowStyle: 'display:flex;flex-direction:column;gap:18px;justify-content:space-between;',
                imageStyle: 'width:100%;min-width:0;max-height:350px;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
                contentStyle: 'display:flex;flex-direction:column;gap:14px;',
                titleStyle: 'margin:0;font-size:1rem;color:#111827;line-height:1.2;letter-spacing:-0.02em;',
                priceStyle: 'font-size:1.1rem;font-weight:600;color:#111827;',
                descriptionStyle: 'color:#475569;line-height:1.7;font-size:0.95rem;',
                actionsStyle: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;'
            };
        }

        if (variant === 'minimal') {
            return {
                variant,
                rootStyle: 'padding:16px 18px;max-width:760px;margin:0 auto;',
                rowStyle: 'display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;',
                imageStyle: 'flex:0 0 84px;width:84px;height:84px;min-width:84px;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
                contentStyle: 'flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:6px;',
                titleStyle: 'margin:0;font-size:1rem;color:#111827;line-height:1.28;',
                priceStyle: 'font-size:1.05rem;font-weight:600;color:#111827;',
                descriptionStyle: 'display:none;',
                actionsStyle: 'display:none;',
                showDescription: false,
                showActions: false
            };
        }

        return {
            variant: 'horizontal',
            rootStyle: 'padding:24px;max-width:1040px;margin:0 auto;',
            rowStyle: 'display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;justify-content:space-between;',
            imageStyle: 'flex:1.15 1 360px;min-width:280px;aspect-ratio:4 / 3;position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;',
            contentStyle: 'flex:0.95 1 320px;min-width:240px;display:flex;flex-direction:column;gap:14px;padding:4px 0;',
            titleStyle: 'margin:0;font-size:1rem;color:#111827;line-height:1.22;letter-spacing:-0.01em;',
            priceStyle: 'font-size:1.15rem;font-weight:600;color:#111827;',
            descriptionStyle: 'color:#475569;line-height:1.7;font-size:0.95rem;',
            actionsStyle: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;'
        };
    };

    const getProductImageList = (product) => {
        if (!product) return [];
        const images = Array.isArray(product.images)
            ? product.images.filter(Boolean)
            : (product.image ? [product.image] : []);
        return images.slice(0, 4);
    };

    const setProductImageList = (product, images) => {
        if (!product) return [];
        const normalized = Array.from(new Set((images || []).filter(Boolean))).slice(0, 4);
        product.images = normalized;
        product.image = normalized[0] || '';
        return normalized;
    };

    const resizeImageFile = (file, maxSize = 1800) => {
        return new Promise((resolve) => {
            if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file);
            const img = new Image();
            const reader = new FileReader();
            reader.onload = () => {
                img.onload = () => {
                    const width = img.width;
                    const height = img.height;
                    const ratio = Math.min(1, maxSize / Math.max(width, height));
                    if (ratio >= 1) {
                        resolve(file);
                        return;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(width * ratio);
                    canvas.height = Math.round(height * ratio);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(new File([blob], file.name, { type: blob.type }));
                        } else {
                            resolve(file);
                        }
                    }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
                };
                img.onerror = () => resolve(file);
                img.src = reader.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
        });
    };

    const uploadImageBlob = async (blob, filename) => {
        const root = (window.APP_ROOT || window.STREET_ROOT || location.pathname.replace(/\/builder(?:\/.*)?$/, '') || '').replace(/\/$/, '');
        const uploadUrl = `${root}/uploader/st_ajax_upload_new.php?tinymce=1`;
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('type', 'post-content');
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            throw new Error(`Upload thất bại: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        let imageUrl = '';
        if (data && typeof data === 'object') {
            if (data.location) imageUrl = data.location;
            else if (data.url) imageUrl = data.url;
            else if (Array.isArray(data) && data[0] && data[0].url) imageUrl = data[0].url;
        }
        if (!imageUrl) {
            throw new Error('Không nhận được URL ảnh từ server.');
        }
        return imageUrl;
    };

    const productGalleryState = {
        pageId: '',
        sectionIndex: 0,
        imageIndex: 0,
        open: false
    };

    const productGalleryDragState = {
        active: false,
        dragging: false,
        pointerId: null,
        sourceIndex: -1,
        hoverIndex: -1,
        startX: 0,
        startY: 0,
        suppressClick: false
    };

    const isProductGalleryEditMode = () => document.body.classList.contains('live-update-mode');

    const getProductForSection = (pageId, sectionIndex) => {
        const page = currentHouse?.pages?.find(p => p.id === pageId);
        const section = page?.sections?.[sectionIndex];
        if (!section?.product_ref || !Array.isArray(currentHouse?.product_pool)) return null;
        return currentHouse.product_pool.find(item => item.id === section.product_ref) || null;
    };

    const refreshProductGalleryModal = () => {
        const modal = document.getElementById('st-product-gallery-modal');
        if (!modal) return;
        const product = getProductForSection(productGalleryState.pageId, productGalleryState.sectionIndex);
        const images = getProductImageList(product);
        if (!images.length) {
            closeProductGalleryModal();
            return;
        }
        if (productGalleryState.imageIndex >= images.length) {
            productGalleryState.imageIndex = images.length - 1;
        }
        if (productGalleryState.imageIndex < 0) productGalleryState.imageIndex = 0;

        const activeImage = images[productGalleryState.imageIndex];
        const isEdit = isProductGalleryEditMode();
        const thumbnailsHtml = images.map((image, index) => `
            <button type="button" class="st-product-gallery-thumb${index === productGalleryState.imageIndex ? ' active' : ''}" data-gallery-thumb-index="${index}">
                ${isEdit ? '<span class="st-product-gallery-drag-handle" data-gallery-drag-handle="1" aria-hidden="true">⋮⋮</span>' : ''}
                <img src="${image}" alt="Ảnh ${index + 1}" />
                ${isEdit ? `
                    <span class="st-product-gallery-thumb-actions">
                        <span class="st-product-gallery-thumb-action" data-gallery-action="delete" data-gallery-index="${index}" title="Xóa">×</span>
                        <span class="st-product-gallery-thumb-action" data-gallery-action="move-left" data-gallery-index="${index}" title="Qua trái">‹</span>
                        <span class="st-product-gallery-thumb-action" data-gallery-action="move-right" data-gallery-index="${index}" title="Qua phải">›</span>
                    </span>
                ` : ''}
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="st-product-gallery-backdrop" data-gallery-close="1"></div>
            <div class="st-product-gallery-card${isEdit ? ' edit-mode' : ''}" role="dialog" aria-modal="true" aria-label="Gallery ảnh sản phẩm">
                <button type="button" class="st-product-gallery-close" data-gallery-close="1">×</button>
                <div class="st-product-gallery-stage">
                    <img class="st-product-gallery-main" src="${activeImage}" alt="Ảnh sản phẩm" />
                    <button type="button" class="st-product-gallery-nav prev" data-gallery-nav="prev" ${images.length <= 1 ? 'disabled' : ''}>‹</button>
                    <button type="button" class="st-product-gallery-nav next" data-gallery-nav="next" ${images.length <= 1 ? 'disabled' : ''}>›</button>
                    ${isEdit ? `
                        <div class="st-product-gallery-floating-actions">
                            <button type="button" class="st-product-gallery-action-btn" data-gallery-action="move-left" ${productGalleryState.imageIndex <= 0 ? 'disabled' : ''}>Qua trái</button>
                            <button type="button" class="st-product-gallery-action-btn" data-gallery-action="move-right" ${productGalleryState.imageIndex >= images.length - 1 ? 'disabled' : ''}>Qua phải</button>
                            <button type="button" class="st-product-gallery-action-btn danger" data-gallery-action="delete">Xóa ảnh</button>
                        </div>
                        <button type="button" class="st-product-gallery-upload-btn" id="st-product-gallery-upload-btn" title="Upload ảnh">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M12 5.5V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M8.7 8.8L12 5.5l3.3 3.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M5.75 14.5h12.5c.69 0 1.25.56 1.25 1.25v1.25c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25v-1.25c0-.69.56-1.25 1.25-1.25Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <input type="file" id="st-product-gallery-upload-file" accept="image/*" multiple style="display:none;" />
                    ` : ''}
                </div>
                ${isEdit ? `<div class="st-product-gallery-thumbs">${thumbnailsHtml}</div>` : ''}
            </div>
        `;

        modal.querySelectorAll('[data-gallery-thumb-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (productGalleryDragState.suppressClick) {
                    productGalleryDragState.suppressClick = false;
                    return;
                }
                productGalleryState.imageIndex = Number(btn.dataset.galleryThumbIndex);
                refreshProductGalleryModal();
            });
        });

        modal.querySelectorAll('[data-gallery-nav]').forEach(btn => {
            btn.addEventListener('click', () => {
                const direction = btn.dataset.galleryNav;
                if (direction === 'prev') productGalleryState.imageIndex = Math.max(0, productGalleryState.imageIndex - 1);
                if (direction === 'next') productGalleryState.imageIndex = Math.min(images.length - 1, productGalleryState.imageIndex + 1);
                refreshProductGalleryModal();
            });
        });

        modal.querySelectorAll('[data-gallery-action]').forEach(btn => {
            btn.addEventListener('click', async (event) => {
                event.stopPropagation();
                const action = btn.dataset.galleryAction;
                const index = Number(btn.dataset.galleryIndex ?? productGalleryState.imageIndex);
                await handleProductGalleryAction(action, index);
            });
        });

        if (isEdit) {
            const uploadBtn = modal.querySelector('#st-product-gallery-upload-btn');
            const fileInput = modal.querySelector('#st-product-gallery-upload-file');
            if (uploadBtn && fileInput) {
                uploadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', async (event) => {
                    const selectedFiles = Array.from(event?.target?.files || []);
                    if (!selectedFiles.length) return;
                    const product = getProductForSection(productGalleryState.pageId, productGalleryState.sectionIndex);
                    if (!product) return;
                    const currentImages = getProductImageList(product);
                    const remainingSlots = Math.max(0, 4 - currentImages.length);
                    const filesToUpload = selectedFiles.slice(0, remainingSlots);
                    if (!filesToUpload.length) {
                        alert('Sản phẩm đã đạt tối đa 4 ảnh.');
                        fileInput.value = '';
                        return;
                    }
                    uploadBtn.disabled = true;
                    try {
                        const uploadedUrls = [];
                        for (const file of filesToUpload) {
                            const resized = await resizeImageFile(file, 1800);
                            const imageUrl = await uploadImageBlob(resized, file.name);
                            uploadedUrls.push(imageUrl);
                        }
                        if (typeof window.syncProductGalleryImages === 'function') {
                            window.syncProductGalleryImages(productGalleryState.pageId, productGalleryState.sectionIndex, currentImages.concat(uploadedUrls));
                        } else {
                            setProductImageList(product, currentImages.concat(uploadedUrls));
                        }
                        productGalleryState.imageIndex = currentImages.length;
                        await saveProductChanges(productGalleryState.pageId);
                        refreshProductGalleryModal();
                    } catch (err) {
                        console.error('Lỗi upload ảnh sản phẩm:', err);
                        alert(err?.message || 'Upload ảnh sản phẩm thất bại.');
                    } finally {
                        uploadBtn.disabled = false;
                        fileInput.value = '';
                    }
                });
            }
        }

        if (isEdit) {
            modal.querySelectorAll('[data-gallery-drag-handle="1"]').forEach(handle => {
                handle.style.touchAction = 'none';
                handle.style.pointerEvents = 'auto';
                handle.addEventListener('pointerdown', onProductGalleryThumbPointerDown, { passive: false });
                handle.addEventListener('pointermove', onProductGalleryThumbPointerMove, { passive: false });
                handle.addEventListener('pointerup', onProductGalleryThumbPointerUp, { passive: false });
                handle.addEventListener('pointercancel', onProductGalleryThumbPointerCancel, { passive: false });
                handle.addEventListener('lostpointercapture', onProductGalleryThumbPointerCancel, { passive: false });
            });
        }
    };

    const resetProductGalleryDragState = () => {
        productGalleryDragState.active = false;
        productGalleryDragState.dragging = false;
        productGalleryDragState.pointerId = null;
        productGalleryDragState.sourceIndex = -1;
        productGalleryDragState.hoverIndex = -1;
        productGalleryDragState.startX = 0;
        productGalleryDragState.startY = 0;
        productGalleryDragState.suppressClick = true;
        const modal = document.getElementById('st-product-gallery-modal');
        if (modal) {
            modal.classList.remove('dragging');
            modal.querySelectorAll('.st-product-gallery-thumb').forEach(el => {
                el.classList.remove('dragging', 'drop-target');
            });
        }
    };

    const updateProductGalleryDragHover = (hoverIndex) => {
        const modal = document.getElementById('st-product-gallery-modal');
        if (!modal) return;
        modal.querySelectorAll('.st-product-gallery-thumb').forEach(el => {
            el.classList.toggle('drop-target', Number(el.dataset.galleryThumbIndex) === hoverIndex);
        });
    };

    const findNearestProductGalleryThumbIndex = (clientX, clientY) => {
        const modal = document.getElementById('st-product-gallery-modal');
        if (!modal) return -1;
        const thumbs = Array.from(modal.querySelectorAll('.st-product-gallery-thumb'));
        if (!thumbs.length) return -1;
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        thumbs.forEach((thumb) => {
            const rect = thumb.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.hypot(clientX - centerX, clientY - centerY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = Number(thumb.dataset.galleryThumbIndex);
            }
        });
        return bestIndex;
    };

    const reorderProductGalleryImages = async (fromIndex, toIndex) => {
        const product = getProductForSection(productGalleryState.pageId, productGalleryState.sectionIndex);
        if (!product) return;
        const images = getProductImageList(product);
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= images.length || toIndex >= images.length || fromIndex === toIndex) return;
        const updatedImages = images.slice();
        const [moved] = updatedImages.splice(fromIndex, 1);
        updatedImages.splice(toIndex, 0, moved);
        if (typeof window.syncProductGalleryImages === 'function') {
            window.syncProductGalleryImages(productGalleryState.pageId, productGalleryState.sectionIndex, updatedImages);
        } else {
            setProductImageList(product, updatedImages);
        }
        productGalleryState.imageIndex = toIndex;
        await saveProductChanges(productGalleryState.pageId);
        refreshProductGalleryModal();
    };

    const onProductGalleryThumbPointerDown = (event) => {
        if (!isProductGalleryEditMode()) return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget?.closest?.('.st-product-gallery-thumb') || event.currentTarget?.parentElement;
        if (!target) return;
        const index = Number(target.dataset.galleryThumbIndex);
        if (Number.isNaN(index)) return;
        productGalleryDragState.active = true;
        productGalleryDragState.dragging = false;
        productGalleryDragState.pointerId = event.pointerId;
        productGalleryDragState.sourceIndex = index;
        productGalleryDragState.hoverIndex = index;
        productGalleryDragState.startX = event.clientX;
        productGalleryDragState.startY = event.clientY;
        target.classList.add('dragging');
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        const modal = document.getElementById('st-product-gallery-modal');
        if (modal) modal.classList.add('drag-prep');
    };

    const onProductGalleryThumbPointerMove = (event) => {
        if (!productGalleryDragState.active || event.pointerId !== productGalleryDragState.pointerId) return;
        const dx = Math.abs(event.clientX - productGalleryDragState.startX);
        const dy = Math.abs(event.clientY - productGalleryDragState.startY);
        if (!productGalleryDragState.dragging && Math.max(dx, dy) > 6) {
            productGalleryDragState.dragging = true;
            const modal = document.getElementById('st-product-gallery-modal');
            if (modal) modal.classList.add('dragging');
        }
        if (!productGalleryDragState.dragging) return;
        event.preventDefault();
        const hoverIndex = findNearestProductGalleryThumbIndex(event.clientX, event.clientY);
        if (hoverIndex !== productGalleryDragState.hoverIndex) {
            productGalleryDragState.hoverIndex = hoverIndex;
            updateProductGalleryDragHover(hoverIndex);
        }
    };

    const onProductGalleryThumbPointerUp = async (event) => {
        if (!productGalleryDragState.active || event.pointerId !== productGalleryDragState.pointerId) return;
        const target = event.currentTarget?.closest?.('.st-product-gallery-thumb') || event.currentTarget?.parentElement;
        try {
            if (!productGalleryDragState.dragging) {
                const index = Number(target?.dataset.galleryThumbIndex);
                if (!Number.isNaN(index)) {
                    productGalleryState.imageIndex = index;
                    refreshProductGalleryModal();
                }
                return;
            }
            const dropIndex = findNearestProductGalleryThumbIndex(event.clientX, event.clientY);
            if (!Number.isNaN(dropIndex) && dropIndex >= 0) {
                await reorderProductGalleryImages(productGalleryDragState.sourceIndex, dropIndex);
            }
        } finally {
            resetProductGalleryDragState();
        }
    };

    const onProductGalleryThumbPointerCancel = () => {
        resetProductGalleryDragState();
    };

    const ensureProductGalleryModal = () => {
        let modal = document.getElementById('st-product-gallery-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'st-product-gallery-modal';
        modal.className = 'st-product-gallery-modal';
        document.body.appendChild(modal);
        modal.addEventListener('click', (event) => {
            if (event.target && event.target.dataset && event.target.dataset.galleryClose === '1') {
                closeProductGalleryModal();
            }
        });
        return modal;
    };

    const closeProductGalleryModal = () => {
        const modal = document.getElementById('st-product-gallery-modal');
        if (!modal) return;
        modal.classList.remove('active');
        modal.innerHTML = '';
        productGalleryState.open = false;
    };

    const saveProductChanges = async (pageId) => {
        if (typeof window.saveCurrentHouseToHost === 'function') {
            await window.saveCurrentHouseToHost(false).catch(err => console.error('Lỗi lưu product gallery lên host:', err));
        }
        const shouldRefresh = !!(pageId && window.streetLive && typeof window.streetLive.showPage === 'function');
        const savedScroll = shouldRefresh ? window.scrollY || window.pageYOffset : 0;
        if (shouldRefresh) window.streetLive.showPage(pageId);
        if (shouldRefresh) window.scrollTo(0, savedScroll);
    };

    const handleProductGalleryAction = async (action, index) => {
        const product = getProductForSection(productGalleryState.pageId, productGalleryState.sectionIndex);
        if (!product) return;
        const images = getProductImageList(product);
        if (!images.length) return;

        let updatedImages = images.slice();
        if (action === 'delete') {
            updatedImages.splice(index, 1);
            if (!updatedImages.length) {
                if (typeof window.syncProductGalleryImages === 'function') {
                    window.syncProductGalleryImages(productGalleryState.pageId, productGalleryState.sectionIndex, []);
                } else {
                    setProductImageList(product, []);
                }
                await saveProductChanges(productGalleryState.pageId);
                closeProductGalleryModal();
                return;
            }
            productGalleryState.imageIndex = Math.min(index, updatedImages.length - 1);
        } else if (action === 'move-left' && index > 0) {
            [updatedImages[index - 1], updatedImages[index]] = [updatedImages[index], updatedImages[index - 1]];
            productGalleryState.imageIndex = index - 1;
        } else if (action === 'move-right' && index < updatedImages.length - 1) {
            [updatedImages[index], updatedImages[index + 1]] = [updatedImages[index + 1], updatedImages[index]];
            productGalleryState.imageIndex = index + 1;
        } else {
            return;
        }

        if (typeof window.syncProductGalleryImages === 'function') {
            window.syncProductGalleryImages(productGalleryState.pageId, productGalleryState.sectionIndex, updatedImages);
        } else {
            setProductImageList(product, updatedImages);
        }
        await saveProductChanges(productGalleryState.pageId);
        refreshProductGalleryModal();
    };

    const openProductGalleryModal = (pageId, sectionIndex, imageIndex = 0) => {
        const product = getProductForSection(pageId, sectionIndex);
        const images = getProductImageList(product);
        if (!images.length) return;
        productGalleryState.pageId = pageId;
        productGalleryState.sectionIndex = sectionIndex;
        productGalleryState.imageIndex = Math.max(0, Math.min(imageIndex, images.length - 1));
        productGalleryState.open = true;
        const modal = ensureProductGalleryModal();
        modal.classList.add('active');
        refreshProductGalleryModal();
    };

    if (!window.__stProductGalleryClickBound) {
        window.__stProductGalleryClickBound = true;
        document.addEventListener('click', (event) => {
            const trigger = event.target?.closest?.('[data-product-gallery-trigger="1"]');
            if (!trigger) return;
            const pageId = trigger.dataset.pageId;
            const sectionIndex = Number(trigger.dataset.sectionIndex);
            if (!pageId || Number.isNaN(sectionIndex)) return;
            event.preventDefault();
            openProductGalleryModal(pageId, sectionIndex, 0);
        });
    }

    const openProductDetailPopup = (pageId, sectionIndex) => {
        const page = currentHouse?.pages?.find(p => p.id === pageId);
        const section = page?.sections?.[sectionIndex];
        if (!section) return;
        const product = getProductDataForSection(section, currentHouse);
        const images = getProductImageList(product);
        const title = product?.title || section?.title || 'Sản phẩm';
        const rawPrice = String(product?.price || '');
        const priceMatch = rawPrice.match(/^([\d\.,\s]+)(.*)$/);
        const priceAmount = priceMatch ? formatPriceAmount(priceMatch[1].trim()) : rawPrice;
        const priceUnit = escapeHtml(priceMatch ? priceMatch[2].trim() : '');
        const priceHtml = rawPrice ? (priceUnit ? `${priceAmount}<span style="font-size:0.85em;font-weight:600;">${priceUnit}</span>` : priceAmount) : '';
        const description = escapeHtml(product?.description || '');
        const phone = product?.phone || '';
        const zalo = product?.zalo || '';
        const buttonLabel = escapeHtml(product?.buttonLabel || 'Gọi điện thoại');
        const accent = currentAccent || 'var(--accent, #f97316)';
        const mainImg = images[0] || '';

        let popup = document.getElementById('st-product-detail-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'st-product-detail-popup';
            document.body.appendChild(popup);
            popup.addEventListener('click', (e) => {
                if (e.target === popup) popup.classList.remove('active');
            });
        }
        popup.innerHTML = `
            <div class="st-pdp-card">
                <button type="button" class="st-pdp-close" id="st-pdp-close-btn">×</button>
                ${mainImg ? `<img class="st-pdp-img" src="${escapeHtml(mainImg)}" alt="${escapeHtml(title)}" id="st-pdp-main-img" />` : ''}
                <div class="st-pdp-body">
                    <h2 class="st-pdp-title">${escapeHtml(title)}</h2>
                    ${priceHtml ? `<div class="st-pdp-price">${priceHtml}</div>` : ''}
                    ${description ? `<div class="st-pdp-desc">${description}</div>` : ''}
                    <div class="st-pdp-actions">
                        ${phone ? `<a href="tel:${escapeHtml(phone)}" class="st-btn-link" style="background:${accent};min-width:140px;">${buttonLabel}</a>` : ''}
                        ${zalo ? `<a href="https://zalo.me/${escapeHtml(String(zalo).replace(/\D/g,''))}" class="st-btn-link" style="background:#2d8cff;min-width:140px;">Chat Zalo</a>` : ''}
                    </div>
                </div>
            </div>`;
        popup.classList.add('active');
        const closeBtn = popup.querySelector('#st-pdp-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => popup.classList.remove('active'));
        if (images.length > 1) {
            const imgEl = popup.querySelector('#st-pdp-main-img');
            if (imgEl) {
                imgEl.style.cursor = 'pointer';
                imgEl.title = 'Xem tất cả ảnh';
                imgEl.addEventListener('click', () => {
                    popup.classList.remove('active');
                    openProductGalleryModal(pageId, sectionIndex, 0);
                });
            }
        }
    };

    if (!window.__stProductDetailClickBound) {
        window.__stProductDetailClickBound = true;
        document.addEventListener('click', (event) => {
            const trigger = event.target?.closest?.('[data-product-detail="1"]');
            if (!trigger) return;
            event.preventDefault();
            const pageId = trigger.dataset.pageId;
            const sectionIndex = Number(trigger.dataset.sectionIndex);
            if (!pageId || Number.isNaN(sectionIndex)) return;
            openProductDetailPopup(pageId, sectionIndex);
        });
    }

    const formatPriceAmount = (value) => {
        const digits = String(value).replace(/\D/g, '');
        if (!digits) return '';
        return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    };

    // --- 2. Inject CSS ---
    const style = document.createElement('style');
    style.innerHTML = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { overscroll-behavior-x: none; touch-action: pan-y; background: #fff; }
        body { padding-top: 70px; }
        #house-template { position: relative; z-index: 1; }
        .st-page-surface {
            width: min(800px, calc(100% - 32px));
            margin: 0 auto;
            background: #fff;
        }

        #street-bar, #st-menu {
            -webkit-transform: translateZ(0);
            transform: translateZ(0);
            backface-visibility: hidden;
            will-change: transform, opacity;
        }

        #street-bar { position: fixed; top: 0; left: 0; width: 100%; height: 70px; z-index: 200700; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; font-family: sans-serif; color: #fff; }
        .st-store-info { display: flex; flex-direction: column; line-height: 1.1; flex: 1; min-width: 0; }
        .st-house-name { font-size: 15px; font-weight: 600; display: inline-flex; padding: 2px 4px; border-radius: 6px; transition: all 0.18s ease; }
        .st-house-location { font-size: 10px; opacity: 0.7; margin-top: 4px; display: inline-flex; padding: 2px 4px; border-radius: 6px; transition: all 0.18s ease; }
        .st-house-location.editable { cursor: pointer; }
        .st-location-dropdown .st-location-option { padding: 10px 16px; white-space: nowrap; cursor: pointer; }
        .st-location-dropdown .st-location-option:hover { background: rgba(59, 130, 246, 0.08); }
        .st-page-title { display: block; padding: 2px 4px; border-radius: 6px; transition: all 0.18s ease; }
        .st-hero-avatar { width: 100px; height: 100px; border-radius: 999px; object-fit: cover; display: block; margin: 0 auto 18px; }
        .st-hero-title { display: inline-block; padding: 2px 4px; border-radius: 6px; transition: all 0.18s ease; }
        .st-page-title.editable,
        .st-hero-title.editable { cursor: pointer; }
        .st-page-slogan { display: block; padding: 2px 4px; border-radius: 6px; transition: all 0.18s ease; margin-top: 6px; }
        .st-page-slogan.editable { cursor: pointer; }
        .st-page-header { padding: 15px 20px 5px; }
        body.live-update-mode .st-page-header { background: rgba(72, 187, 120, 0.08); }
        body.live-update-mode .st-page-header:hover { background: rgba(72, 187, 120, 0.12); }
        body.live-update-mode .st-section,
        body.live-update-mode .st-house-name,
        body.live-update-mode .st-house-location,
        body.live-update-mode .st-page-title { outline: 1px dashed rgba(45, 134, 255, 0.75); outline-offset: 3px; }
        body.live-update-mode .st-section:hover,
        body.live-update-mode .st-house-name:hover,
        body.live-update-mode .st-house-location:hover,
        body.live-update-mode .st-page-title:hover { outline-color: rgba(37, 99, 235, 0.95); }
        body.live-update-mode .st-page-title { background: transparent; }
        body.live-update-mode .st-section.st-hero .st-hero-title {
            outline: none !important;
            border-bottom: 1px dashed rgba(148, 163, 184, 0.8);
            display: inline-block;
            padding-bottom: 1px;
            background: transparent;
            border-radius: 0;
        }
        body.live-update-mode .st-section.st-hero .st-page-slogan {
            outline: none !important;
            background: transparent;
            border-radius: 0;
        }
        body.live-update-mode .st-section.st-hero .st-hero-title:hover,
        body.live-update-mode .st-section.st-hero .st-page-slogan:hover { outline: none; }
        body.live-update-mode .st-section.st-hero .st-page-slogan { margin-top: 6px; }
        body.live-update-mode .st-section.st-hero .st-page-slogan:empty {
            display: block;
        }
        body.live-update-mode .st-section.st-hero .st-page-slogan:empty::before {
            content: 'Lời giới thiệu...';
            color: rgba(148, 163, 184, 0.8);
            display: inline-block;
        }
        .st-section.st-hero .st-page-slogan:empty { display: none; }
        .st-section.st-hero { background: #fff; }
        body.live-update-mode .st-section.st-hero:hover { background: #fff; }
        .st-house-name-input { font-size: 15px; font-weight: 600; color: #111; border: 1px solid rgba(255,255,255,0.85); border-radius: 8px; padding: 4px 8px; min-width: 120px; max-width: 260px; width: auto; background: rgba(255,255,255,0.98); }
        .st-live-login-modal { display:none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100021; justify-content: center; align-items: center; }
        .st-live-login-modal.active { display: flex; }
        .st-live-login-modal .modal-card { width:min(360px,92%); background:#fff; border-radius:14px; padding:18px; box-shadow:0 18px 45px rgba(0,0,0,0.18); }
        .st-live-login-modal .modal-title { font-size:16px; margin-bottom:12px; font-weight:600; }
        .st-live-login-modal .modal-field { margin-bottom:12px; }
        .st-live-login-modal .modal-field input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #d1d5db; font-size:14px; }
        .st-live-login-modal .modal-error { display:none; color:#b91c1c; font-size:13px; min-height:18px; margin-bottom:10px; }
        .st-live-login-modal .modal-error.show { display:block; }
        .st-live-login-modal .modal-actions { display:grid; gap:10px; }
        .st-live-login-modal .modal-actions button { border:none; border-radius:10px; padding:12px 14px; font-size:14px; font-weight:600; cursor:pointer; }
        .st-live-login-modal .modal-actions .primary { background:#2d8cff; color:#fff; }
        .st-live-login-modal .modal-actions .secondary { background:#f1f5f9; color:#334155; }
        .st-location { font-size: 10px; opacity: 0.7; }
        .st-btn { color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; font-size: 16px; cursor: pointer; }
        #st-user-button:hover { background: var(--st-header-btn-hover-bg, rgba(255,255,255,0.35)) !important; }
                /* Let JS compute the menu top so it sits flush to the header (no hard gap). */
                #st-menu { background: #fff; border-bottom: 1px solid #eee; overflow-x: auto; white-space: nowrap; position: fixed; top: 0; left: 0; width: 100%; z-index: 99999; scrollbar-width: none; height: 36px; display: flex; align-items: center; justify-content: flex-start; gap: 0; }
        
        /* Floating Edit Button */
        #st-floating-edit-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 100200;
            width: 52px;
            height: 52px;
            border: none;
            border-radius: 50%;
            background: #2563eb;
            color: #fff;
            font-size: 20px;
            font-weight: 600;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 12px 28px rgba(37, 99, 235, 0.3);
            transition: all 0.2s ease;
        }
        #st-floating-edit-btn:hover {
            background: #1d4ed8;
            transform: scale(1.08);
            box-shadow: 0 16px 36px rgba(37, 99, 235, 0.4);
        }
        #st-floating-edit-btn:active {
            transform: scale(0.96);
        }
        
        /* Edit Mode Top Bar */
        #st-edit-mode-bar {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 52px;
            background: linear-gradient(90deg, #3b82f6 0%, #1e40af 100%);
            backdrop-filter: blur(6px) saturate(110%);
            -webkit-backdrop-filter: blur(6px) saturate(110%);
            border-bottom: 1px solid rgba(0,0,0,0.12);
            z-index: 200800;
            flex-direction: row;
            align-items: center;
            padding: 0 16px;
            gap: 12px;
            box-shadow: 0 6px 16px rgba(0,0,0,0.12);
            color: #fff;
        }
        #st-edit-mode-bar.active {
            display: flex;
        }
        #st-edit-mode-bar .label {
            font-size: 14px;
            font-weight: 600;
            color: rgba(255,255,255,0.95);
            margin-right: auto;
        }
        #st-edit-mode-bar .actions {
            display: flex;
            gap: 10px;
            align-items: center;
        }
        /* Buttons on the top bar: translucent over the background */
        #st-edit-mode-bar button {
            border: 1px solid rgba(255,255,255,0.08);
            background: rgba(107,114,128,0.22); /* translucent gray */
            color: #fff;
            padding: 8px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s ease, transform 0.12s ease;
            box-shadow: 0 6px 14px rgba(2,6,23,0.12);
            backdrop-filter: none;
        }
        #st-edit-mode-bar button:hover {
            background: rgba(75,85,99,0.32);
            transform: translateY(-1px);
        }
        #st-edit-mode-bar button.save,
        #st-edit-mode-bar button.exit {
            background: rgba(107,114,128,0.22);
            border-color: rgba(255,255,255,0.1);
        }

        body.st-edit-mode-active {
            --st-edit-bar-height: 52px;
        }
        body.st-edit-mode-active #street-bar {
            top: var(--st-edit-bar-height, 52px) !important;
        }
        body.st-edit-mode-active #st-menu {
            top: calc(70px + var(--st-edit-bar-height, 52px)) !important;
        }

        /* When edit bar is active, force sticky header directly below it. */
        body.st-edit-mode-active #street-bar {
            top: var(--st-edit-bar-height, 52px) !important;
        }

        /* Product detail popup */
        #st-product-detail-popup {
            display: none; position: fixed; inset: 0; z-index: 300000;
            background: rgba(0,0,0,0.55); align-items: center; justify-content: center;
        }
        #st-product-detail-popup.active { display: flex; }
        #st-product-detail-popup .st-pdp-card {
            background: #fff; border-radius: 20px; width: min(480px, 94vw);
            max-height: 88vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(0,0,0,0.22);
            position: relative; display: flex; flex-direction: column;
        }
        #st-product-detail-popup .st-pdp-img {
            width: 100%; aspect-ratio: 4/3; object-fit: cover;
            border-radius: 20px 20px 0 0; display: block; cursor: pointer;
        }
        #st-product-detail-popup .st-pdp-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        #st-product-detail-popup .st-pdp-title { font-size: 1.15rem; font-weight: 600; color: #111827; margin: 0; }
        #st-product-detail-popup .st-pdp-price { font-size: 1.25rem; font-weight: 600; color: var(--accent, #f97316); }
        #st-product-detail-popup .st-pdp-desc { font-size: 0.93rem; color: #4b5563; line-height: 1.6; }
        #st-product-detail-popup .st-pdp-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
        #st-product-detail-popup .st-pdp-close {
            position: absolute; top: 12px; right: 12px; width: 34px; height: 34px;
            border: none; border-radius: 50%; background: rgba(0,0,0,0.45); color: #fff;
            font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center;
            z-index: 2; line-height: 1;
        }
        .st-product-detail-link {
            display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600;
            color: var(--accent, #2563eb); text-decoration: underline; text-underline-offset: 2px;
            cursor: pointer; background: none; border: none; padding: 0;
        }
        .st-product-detail-link:hover { opacity: 0.75; }
        
        #st-menu.hidden { display: none !important; }
        #st-menu.align-center { justify-content: center; }
        #st-menu.align-right { justify-content: flex-end; }
        #st-menu.mode-stack { flex-direction: column; align-items: stretch; height: auto; white-space: normal; overflow-x: hidden; }
        #st-menu.mode-stack .st-menu-item { display: block; width: 100%; border-bottom: 1px solid #eee; text-align: center; }
        #st-menu.mode-stack .st-menu-item:last-child { border-bottom-color: transparent; }
        #st-menu::-webkit-scrollbar { display: none; }
        .st-menu-item { padding: 0 15px; line-height: 36px; font-size: 11px; font-weight: 600; color: var(--st-menu-text-color, #999); text-decoration: none; cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; display: inline-block; text-transform: uppercase; }
        #st-menu .st-menu-item:hover { color: var(--st-menu-hover-color, #666); border-bottom-color: var(--st-menu-hover-color, #666); }
        .st-menu-item.active { color: var(--st-menu-active-color, #666); border-bottom: 2px solid var(--st-menu-active-color, #666); font-weight: 600; }
        .st-menu-edit-btn { position: absolute; top: 4px; right: 10px; width: 34px; height: 34px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.4); background: #fff; color: #334155; font-size: 16px; cursor: pointer; display: none; place-items: center; box-shadow: 0 6px 18px rgba(0,0,0,0.08); transition: 0.18s ease; }
        body.live-update-mode .st-menu-edit-btn { display: grid; }
        .st-menu-edit-btn:hover { background: #f8fafc; border-color: rgba(148,163,184,0.75); }
        .st-edit-action-btn { display: none; align-items: center; justify-content: center; }
        body.live-update-mode .st-edit-action-btn { display: inline-flex; }

        #st-menu-panel-overlay { position: fixed; inset: 0; z-index: 200002; display: none; background: rgba(0,0,0,0.35); }
        #st-menu-panel { position: fixed; top: 0; left: 0; bottom: 0; width: min(280px, 85vw); max-width: 320px; background: #fff; z-index: 200003; box-shadow: 4px 0 20px rgba(0,0,0,0.18); transform: translateX(-100%); transition: transform 0.25s ease; display: flex; flex-direction: column; overflow-y: auto; }
        #st-menu-panel.open { transform: translateX(0); }
        #st-menu-panel .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid #eee; }
        #st-menu-panel .panel-title { font-weight: 600; font-size: 14px; }
        #st-menu-panel .panel-close { border: none; background: #eee; width: 34px; height: 34px; border-radius: 8px; font-size: 18px; cursor: pointer; }
        #st-menu-panel-list { padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
        #st-menu-panel-list .st-menu-item { display: block; padding: 12px 10px; border-bottom: 1px solid #f0f0f0; }

        .st-section { padding: 10px 15px; }
        .st-section.st-text { padding: 24px; }
        body.live-update-mode .st-section { outline: 1px dashed rgba(56, 161, 105, 0.75); outline-offset: -8px; transition: outline 0.18s ease, background-color 0.18s ease; }
        body.live-update-mode .st-section:hover { outline: 2px dashed rgba(38, 166, 91, 0.95); background: rgba(72, 187, 120, 0.06); }
        body.live-update-mode .st-section * { position: relative; }
        .st-text { line-height: 1.5; color: #444; font-size: 14px; }
        .st-text.has-title { display: flex; flex-direction: column; gap: 10px; }
        .st-text.has-title .st-text-title { margin: 0; font-size: 1rem; font-weight: 600; color: #1f2937; }
        .st-text.has-title .st-text-title.st-text-title-empty { display: none; }
        body.live-update-mode .st-text.has-title .st-text-title.st-text-title-empty { display: block; color: #64748b; font-weight: 600; }
        body.live-update-mode .st-text.has-title .st-text-title.st-text-title-empty::after { content: attr(data-placeholder); }
        .st-text .st-text-content.st-text-content-empty { position: relative; min-height: 1.4rem; }
        body.live-update-mode .st-text .st-text-content.st-text-content-empty::after {
            content: attr(data-placeholder);
            color: #64748b;
            display: block;
            white-space: pre-wrap;
        }
        .st-text.has-title .st-text-content { padding-top: 6px; }
        .st-text.st-text-empty { border: 1px dashed #cbd5e1; border-radius: 10px; }
        .st-image { max-width: 100%; width: auto; height: auto; display: block; margin: 0 auto; border-radius: 6px; }
        .st-product-gallery-trigger {
            position: relative;
            display: block;
            width: 100%;
            padding: 0;
            border: none;
            background: transparent;
            cursor: zoom-in;
            text-align: left;
        }
        .st-product-gallery-trigger img { width: 100%; height: auto; display: block; border-radius: 16px; object-fit: cover; }
        .st-section.st-banner img,
        .st-section.st-product.st-product-layout-banner {
            background: #fff !important;
        }
        .st-section.st-product.st-product-layout-banner .st-product-layout-shell,
        .st-section.st-product.st-product-layout-banner .st-product-layout-media {
            background: transparent !important;
        }
        .st-section.st-product.st-product-layout-banner .st-product-layout-media {
            width: 100%;
            max-height: 350px;
            overflow: hidden;
        }
        .st-section.st-product.st-product-layout-banner .st-product-layout-media img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        @media (max-width: 768px) {
            .st-section.st-banner img,
            .st-section.st-product.st-product-layout-banner .st-product-layout-media {
                max-height: 200px;
            }
        }
        .st-product-gallery-modal {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 200800;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(15, 23, 42, 0.72);
            backdrop-filter: blur(8px);
        }
        .st-product-gallery-modal.active { display: flex; }
        .st-product-gallery-backdrop { position: absolute; inset: 0; }
        .st-product-gallery-card {
            position: relative;
            width: 100vw;
            height: 100vh;
            max-width: none;
            max-height: none;
            overflow: hidden;
            border-radius: 0;
            background: #fff;
            box-shadow: 0 24px 80px rgba(0,0,0,0.28);
            padding: 20px;
            z-index: 1;
            display: flex;
            flex-direction: column;
        }
        .st-product-gallery-card.edit-mode { padding: 20px 20px 88px; }
        .st-product-gallery-close {
            position: absolute;
            top: 12px;
            right: 12px;
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 50%;
            background: #f8fafc;
            color: #0f172a;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            z-index: 2;
        }
        .st-product-gallery-stage { position: relative; flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto; background: #f8fafc; border-radius: 18px; padding: 12px; }
        .st-product-gallery-main { width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 16px; display: block; background: #fff; }
        .st-product-gallery-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 42px;
            height: 42px;
            border: none;
            border-radius: 999px;
            background: rgba(255,255,255,0.95);
            color: #0f172a;
            font-size: 26px;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 10px 25px rgba(15,23,42,0.12);
            z-index: 2;
        }
        .st-product-gallery-nav.prev { left: 12px; }
        .st-product-gallery-nav.next { right: 12px; }
        .st-product-gallery-nav:disabled { opacity: 0.35; cursor: default; }
        .st-product-gallery-thumbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 10px; margin-top: 14px; }
        .st-product-gallery-thumb {
            position: relative;
            border: 2px solid transparent;
            border-radius: 14px;
            padding: 0;
            background: #f8fafc;
            overflow: hidden;
            cursor: pointer;
            touch-action: none;
            user-select: none;
        }
        .st-product-gallery-thumb.active { border-color: #2563eb; }
        .st-product-gallery-modal.dragging .st-product-gallery-thumb { cursor: grabbing; }
        .st-product-gallery-thumb.dragging {
            opacity: 0.55;
            transform: scale(0.98);
            border-color: #93c5fd;
        }
        .st-product-gallery-thumb.drop-target {
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.14);
        }
        .st-product-gallery-thumb img { width: 100%; height: 92px; object-fit: cover; display: block; }
        .st-product-gallery-drag-handle {
            position: absolute;
            top: 8px;
            left: 8px;
            z-index: 2;
            width: 28px;
            height: 28px;
            border-radius: 999px;
            background: rgba(15,23,42,0.74);
            color: #fff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 1px;
            pointer-events: none;
        }
        .st-product-gallery-thumb-actions { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: flex-end; gap: 6px; padding: 6px; pointer-events: none; }
        .st-product-gallery-thumb-action {
            pointer-events: auto;
            width: 24px;
            height: 24px;
            border-radius: 999px;
            background: rgba(15,23,42,0.78);
            color: #fff;
            font-size: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            line-height: 1;
        }
        .st-product-gallery-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
        .st-product-gallery-action-btn {
            border: none;
            border-radius: 12px;
            padding: 10px 14px;
            background: #eff6ff;
            color: #2563eb;
            font-weight: 600;
            cursor: pointer;
        }
        .st-product-gallery-action-btn.danger { background: #fef2f2; color: #b91c1c; }
        .st-product-gallery-action-btn:disabled,
        .st-product-gallery-thumb-action:disabled { opacity: 0.4; cursor: default; }
        .st-product-gallery-upload-btn { position: absolute; right: 20px; bottom: 20px; z-index: 3; width: 52px; height: 52px; border: none; border-radius: 16px; background: #2563eb; color: #fff; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 16px 32px rgba(37,99,235,0.24); cursor: pointer; }
        .st-product-gallery-upload-btn svg { width: 22px; height: 22px; display: block; }
        .st-product-gallery-upload-btn:hover { background: #1d4ed8; }
        .st-product-gallery-floating-actions {
            position: absolute;
            top: 16px;
            right: 16px;
            z-index: 3;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: flex-end;
            max-width: min(100%, 320px);
        }
        .st-product-gallery-floating-actions .st-product-gallery-action-btn {
            padding: 8px 12px;
            font-size: 13px;
            box-shadow: 0 10px 20px rgba(15,23,42,0.10);
            background: rgba(255,255,255,0.95);
        }
        .st-product-gallery-floating-actions .st-product-gallery-action-btn.danger { background: rgba(254,242,242,0.98); }

        .st-product-layout-shell {
            display: flex;
            flex-wrap: wrap;
            gap: 18px;
            align-items: stretch;
            justify-content: space-between;
        }
        .st-product-layout-media {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: none;
            background: transparent;
            cursor: zoom-in;
            text-align: left;
        }
        .st-product-compact-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            width: 100%;
            align-items: stretch;
        }
        .st-product-compact-grid .st-section.st-product-layout-compact.st-product-compact-grouped {
            display: flex;
            flex-direction: column;
        }
        .st-product-compact-grid .st-section.st-product-layout-compact {
            height: 100%;
        }
        .st-product-layout-media img {
            width: auto !important;
            height: auto !important;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            display: block;
            border-radius: inherit;
        }
        .st-product-layout-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
        }
        .st-product-layout-head {
            display: grid;
            gap: 8px;
        }
        .st-product-title {
            margin: 0;
            font-size: 1rem;
            color: #111827;
            line-height: 1.22;
            letter-spacing: -0.01em;
        }
        .st-product-layout-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: auto;
        }
        .st-product-layout-actions .st-btn-link {
            min-width: 140px;
            justify-content: center;
        }
        .st-product-layout-horizontal,
        .st-product-layout-highlight {
            width: min(100%, 1120px);
        }
        .st-product-layout-reversed {
            width: min(100%, 1040px);
        }
        .st-product-layout-compact {
            width: 100%;
        }
        .st-product-layout-reversed .st-product-layout-shell {
            flex-direction: row-reverse;
        }
        .st-product-layout-reversed .st-product-layout-media {
            flex: 1.15 1 360px;
            min-width: 280px;
        }
        .st-product-layout-reversed .st-product-layout-content {
            flex: 0.95 1 320px;
            min-width: 240px;
            padding-top: 4px;
        }
        .st-product-layout-horizontal .st-product-layout-media {
            flex: 1.15 1 360px;
            min-width: 280px;
        }
        .st-product-layout-horizontal .st-product-layout-content {
            flex: 0.95 1 320px;
            min-width: 240px;
            padding-top: 4px;
        }
        .st-product-layout-compact .st-product-layout-media {
            flex: 0 0 152px;
            width: 152px;
            min-width: 120px;
            max-width: 152px;
        }
        .st-product-compact-grouped .st-product-layout-shell {
            flex-direction: column;
            gap: 12px;
            height: 100%;
        }
        .st-product-compact-grouped .st-product-layout-media {
            width: 100%;
            flex: 0 0 auto;
            min-width: 0;
            max-width: none;
            aspect-ratio: 4 / 3;
        }
        .st-product-compact-grouped .st-product-layout-media img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover;
        }
        .st-product-compact-grouped .st-product-layout-content {
            flex: 1 1 auto;
        }
        .st-product-layout-compact .st-product-layout-shell {
            width: 100%;
        }
        .st-product-layout-compact .st-product-layout-content {
            gap: 8px;
            justify-content: center;
        }
        .st-product-layout-compact .st-product-description,
        .st-product-layout-compact .st-product-layout-actions {
            display: none !important;
        }
        .st-product-layout-highlight .st-product-layout-media {
            flex: 1.25 1 440px;
            min-width: 300px;
        }
        .st-product-layout-highlight .st-product-layout-content {
            flex: 0.9 1 320px;
            min-width: 250px;
            gap: 16px;
            padding-top: 4px;
        }
        .st-product-layout-highlight .st-product-title {
            font-size: 1.6rem;
            line-height: 1.12;
            letter-spacing: -0.02em;
        }
        .st-product-layout-highlight .st-product-price {
            font-size: 1.3rem;
            font-weight: 600;
        }
        .st-product-layout-minimal {
            width: min(100%, 760px);
        }
        .st-product-layout-minimal .st-product-layout-media {
            flex: 0 0 84px;
            width: 84px;
            height: 84px;
        }
        .st-product-layout-minimal .st-product-layout-content {
            flex: 1 1 220px;
            gap: 6px;
        }
        .st-product-layout-minimal .st-product-description,
        .st-product-layout-minimal .st-product-layout-actions {
            display: none !important;
        }
        .st-product-layout-minimal .st-product-title {
            font-size: 1rem;
            line-height: 1.28;
        }
        .st-product-description {
            font-size: 14px;
            line-height: 1.7;
            color: #475569;
        }
        .st-product-layout-minimal .st-product-price {
            font-size: 1.05rem;
            font-weight: 600;
        }
        @media (max-width: 768px) {
            .st-product-layout-shell {
                flex-direction: column;
                gap: 14px;
            }
            .st-product-layout-horizontal,
            .st-product-layout-highlight,
            .st-product-layout-reversed,
            .st-product-layout-compact,
            .st-product-layout-minimal {
                width: 100%;
            }
            .st-product-compact-grid {
                grid-template-columns: 1fr;
                gap: 12px;
            }
            .st-product-layout-horizontal .st-product-layout-media,
            .st-product-layout-highlight .st-product-layout-media,
            .st-product-layout-reversed .st-product-layout-media,
            .st-product-layout-compact .st-product-layout-media,
            .st-product-layout-minimal .st-product-layout-media {
                width: 100%;
                min-width: 0;
                flex-basis: auto;
            }
            .st-product-layout-minimal .st-product-layout-media {
                aspect-ratio: 1 / 1;
                max-width: 132px;
            }
            .st-product-layout-horizontal .st-product-layout-content,
            .st-product-layout-highlight .st-product-layout-content,
            .st-product-layout-reversed .st-product-layout-content,
            .st-product-layout-compact .st-product-layout-content,
            .st-product-layout-minimal .st-product-layout-content {
                width: 100%;
                min-width: 0;
            }
            .st-product-layout-compact .st-product-layout-shell {
                flex-direction: column;
                width: 100%;
                gap: 12px;
            }
            .st-product-layout-compact .st-product-layout-media {
                width: 100%;
                max-width: none;
                min-width: 0;
                flex-basis: auto;
                aspect-ratio: 4 / 3;
            }
            .st-product-compact-grouped .st-product-layout-media {
                width: 100%;
                max-width: none;
                min-width: 0;
                flex-basis: auto;
                aspect-ratio: 4 / 3;
            }
            .st-product-layout-horizontal .st-product-title,
            .st-product-layout-highlight .st-product-title,
            .st-product-layout-reversed .st-product-title,
            .st-product-layout-compact .st-product-title,
            .st-product-layout-minimal .st-product-title {
                font-size: 1.02rem;
            }
            .st-product-layout-highlight .st-product-title {
                font-size: 1.22rem;
            }
            .st-product-layout-horizontal .st-product-layout-actions,
            .st-product-layout-highlight .st-product-layout-actions,
            .st-product-layout-reversed .st-product-layout-actions {
                gap: 8px;
            }
            .st-product-layout-horizontal .st-btn-link,
            .st-product-layout-highlight .st-btn-link,
            .st-product-layout-reversed .st-btn-link {
                width: 100%;
                min-width: 0;
            }
        }
        
        /* Button Link Style */
        .st-btn-link { 
            display: block; width: 100%; padding: 14px; 
            text-align: center; text-decoration: none; 
            color: #fff !important; font-weight: 600; 
            border-radius: 10px; font-size: 15px; 
            transition: 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        .st-btn-link:active { transform: scale(0.97); opacity: 0.9; }

        .st-btn-group { display: flex; align-items: center; gap: 8px; }
        .st-bar-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }

        .st-footer {
            position: relative;
            display: block;
            width: 100%;
            max-width: none;
            background: transparent;
            color: #475569;
            font-size: 14px;
            line-height: 1.7;
        }
        .st-footer-bg {
            width: 100%;
            background: #fff;
            border-top: 1px solid #e2e8f0;
        }
        .st-footer-inner {
            max-width: 800px;
            width: min(100%, 800px);
            margin: 0 auto;
            padding: 20px 24px;
            box-sizing: border-box;
        }
        .st-footer-content {
            display: grid;
            gap: 20px;
        }
        .st-footer-layout-1 {
            grid-template-columns: minmax(0, 1fr);
        }
        .st-footer-layout-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .st-footer-layout-3 {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .st-footer-column {
            display: grid;
            gap: 16px;
            align-content: start;
            min-width: 0;
        }
        .st-footer-block {
            display: grid;
            gap: 10px;
            min-width: 0;
        }
        .st-footer-block-title {
            font-size: 13px;
            font-weight: 600;
            color: #0f172a;
            letter-spacing: 0.01em;
        }
        .st-footer-brand {
            font-weight: 600;
            color: #0f172a;
        }
        .st-footer-text {
            color: #475569;
            white-space: pre-wrap;
        }
        .st-footer-contact {
            display: grid;
            gap: 8px;
        }
        .st-footer-contact-item {
            display: flex;
            gap: 8px;
            align-items: flex-start;
        }
        .st-footer-contact-item span {
            min-width: 0;
        }
        .st-footer-contact-item b {
            min-width: 24px;
            font-weight: 600;
            color: #334155;
        }
        .st-footer-links {
            display: grid;
            gap: 8px;
        }
        .st-footer-link {
            color: #475569;
            text-decoration: none;
            transition: color 0.18s ease;
            word-break: break-word;
        }
        .st-footer-link:hover {
            color: var(--accent, #2563eb);
        }
        .st-footer-empty {
            color: #94a3b8;
            font-size: 13px;
        }
        .st-footer-copy {
            color: #94a3b8;
            font-size: 13px;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #e2e8f0;
        }

        /* Mobile Bottom Actions Bar */
        #st-actions { 
            display: none; position: fixed; bottom: 0; left: 0; width: 100%; height: 48px; 
            background: #f8f9fa; border-top: 1px solid #eee; z-index: 99998; 
            justify-content: space-around; align-items: center; gap: 4px; padding: 0 6px;
            box-shadow: 0 -5px 18px rgba(0,0,0,0.08);
        }
        .st-action-btn { 
            flex: 1; height: 36px; border: 1px solid #ddd; border-radius: 8px; 
            background: #fff; color: #51606f; font-size: 10px; font-weight: 600; 
            cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; 
            align-items: center; justify-content: center; gap: 2px; padding: 0;
        }
        .st-action-btn:hover { background: #f1f3f5; border-color: #ccc; }
        .st-action-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .st-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .st-section.st-new-section:not(.st-product) { outline: 2px dashed #38bdf8; outline-offset: 4px; transition: outline 0.18s ease; cursor: pointer; }
        .st-section.st-new-section.st-product { outline: none; }
        .st-section.st-new-section:not(.st-product):hover { outline-color: #0ea5e9; }
        body.live-update-mode .st-section.st-text:hover { cursor: text; }
        .st-section.st-section-editing { background: rgba(219, 234, 254, 0.6); }


        /* Mobile Responsive */
        @media (max-width: 768px) {
            body { padding-bottom: 0 !important; }
            #st-actions { display: none !important; }
            #st-menu { top: 70px; }
            .st-footer-content {
                grid-template-columns: minmax(0, 1fr) !important;
            }
        }
    `;
    document.head.appendChild(style);

    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const normalizeMenuTextMode = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return ['auto', 'light', 'dark'].includes(normalized) ? normalized : 'auto';
    };
    const parseHexColor = (value) => {
        const raw = String(value || '').trim().replace('#', '');
        if (![3, 4, 6, 8].includes(raw.length)) return null;
        const expanded = raw.length <= 4
            ? raw.split('').map(ch => ch + ch).join('')
            : raw;
        return {
            r: parseInt(expanded.slice(0, 2), 16),
            g: parseInt(expanded.slice(2, 4), 16),
            b: parseInt(expanded.slice(4, 6), 16)
        };
    };
    const parseCssColorToRgb = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (raw.startsWith('#')) return parseHexColor(raw);
        const rgbMatch = raw.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        if (rgbMatch) {
            return {
                r: Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10))),
                g: Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10))),
                b: Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)))
            };
        }
        return null;
    };
    const rgbToCss = (rgb) => {
        if (!rgb) return '';
        return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
    };
    const mixRgb = (from, to, ratio) => {
        const t = clamp01(ratio);
        return {
            r: from.r + (to.r - from.r) * t,
            g: from.g + (to.g - from.g) * t,
            b: from.b + (to.b - from.b) * t
        };
    };
    const darkenRgb = (rgb, amount) => mixRgb(rgb, { r: 0, g: 0, b: 0 }, amount);
    const parseLinearGradientValue = (value) => {
        const raw = String(value || '').trim();
        const match = raw.match(/^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)$/i);
        if (!match) return null;
        return {
            angle: ((parseFloat(match[1]) % 360) + 360) % 360,
            from: parseHexColor(match[2]),
            to: parseHexColor(match[3])
        };
    };
    const getRelativeLuminance = (rgb) => {
        if (!rgb) return 0;
        const channel = (value) => {
            const normalized = value / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    };
    const getContrastRatio = (a, b) => {
        const l1 = getRelativeLuminance(a);
        const l2 = getRelativeLuminance(b);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    };
    const sampleGradientColorAtPoint = (gradient, xRatio, yRatio) => {
        if (!gradient?.from || !gradient?.to) return null;
        const angleRad = (gradient.angle * Math.PI) / 180;
        const vx = Math.sin(angleRad);
        const vy = -Math.cos(angleRad);
        const corners = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 }
        ];
        const projections = corners.map(point => point.x * vx + point.y * vy);
        const minProjection = Math.min(...projections);
        const maxProjection = Math.max(...projections);
        const pointProjection = clamp01(xRatio) * vx + clamp01(yRatio) * vy;
        const range = maxProjection - minProjection;
        const ratio = range > 0 ? (pointProjection - minProjection) / range : 0.5;
        return mixRgb(gradient.from, gradient.to, ratio);
    };
    const getHeaderSamplePoint = (barEl, menuEl) => {
        const fallback = { x: 0.75, y: 0.5 };
        if (!barEl || !menuEl) return fallback;
        const barRect = barEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        if (!barRect.width || !barRect.height || !menuRect.width || !menuRect.height) return fallback;
        return {
            x: clamp01(((menuRect.left + (menuRect.width / 2)) - barRect.left) / barRect.width),
            y: clamp01(((menuRect.top + (menuRect.height / 2)) - barRect.top) / barRect.height)
        };
    };
    const getMenuToneSetting = (house) => {
        const houseId = house?.id || house?.house_id || 'default';
        const houseKey = `house_${houseId}`;
        return normalizeMenuTextMode(
            house?.color_settings?.menu_text_mode ||
            localStorage.getItem(`${houseKey}_menu_text_mode`) ||
            'auto'
        );
    };
    const getHeaderBackgroundForMenu = (house, barEl) => {
        const colorSettings = house?.color_settings || {};
        return colorSettings.header_color || house?.header_background || barEl?.style.background || window.getComputedStyle(barEl).background || '';
    };
    const pickMenuBaseColor = ({ backgroundRgb, logoRgb, mode }) => {
        const lightCandidates = ['#ffffff', '#f8fafc'].map(parseHexColor).filter(Boolean);
        const darkCandidates = ['#020617', '#111827'].map(parseHexColor).filter(Boolean);
        const allCandidates = [...lightCandidates, ...darkCandidates];
        const logoContrast = logoRgb ? getContrastRatio(backgroundRgb, logoRgb) : 0;
        const chooseBest = (candidates) => candidates
            .map(candidate => ({ candidate, contrast: getContrastRatio(backgroundRgb, candidate) }))
            .sort((left, right) => right.contrast - left.contrast)[0];
        const preferredPool = mode === 'light'
            ? lightCandidates
            : mode === 'dark'
                ? darkCandidates
                : (getRelativeLuminance(backgroundRgb) < 0.42 ? lightCandidates : darkCandidates);
        let picked = chooseBest(preferredPool) || chooseBest(allCandidates);
        const strongest = mode === 'auto' ? chooseBest(allCandidates) : null;
        if (strongest && picked && strongest.contrast > picked.contrast + 0.25 && strongest.contrast > logoContrast) {
            picked = strongest;
        }
        return picked?.candidate || parseHexColor('#ffffff');
    };
    const buildAccessibleInteractiveColor = (brandRgb, backgroundRgb, direction, minimumContrast = 3) => {
        if (!brandRgb || !backgroundRgb) return brandRgb;
        const pole = direction === 'light'
            ? { r: 255, g: 255, b: 255 }
            : { r: 0, g: 0, b: 0 };
        let best = brandRgb;
        let bestContrast = getContrastRatio(backgroundRgb, brandRgb);
        for (let step = 0; step <= 10; step += 1) {
            const candidate = step === 0 ? brandRgb : mixRgb(brandRgb, pole, step / 10);
            const contrast = getContrastRatio(backgroundRgb, candidate);
            if (contrast > bestContrast) {
                best = candidate;
                bestContrast = contrast;
            }
            if (contrast >= minimumContrast) {
                return candidate;
            }
        }
        return best;
    };
    const buildMenuInteractiveColors = (brandRgb, backgroundRgb) => {
        const fallback = parseHexColor('#ff6600');
        const baseBrand = brandRgb || fallback;
        const background = backgroundRgb || parseHexColor('#ffffff');
        const prefersLight = getRelativeLuminance(background) < 0.42;
        const primaryDirection = prefersLight ? 'light' : 'dark';
        const secondaryDirection = prefersLight ? 'dark' : 'light';
        let hoverColor = buildAccessibleInteractiveColor(baseBrand, background, primaryDirection, 3);
        if (getContrastRatio(background, hoverColor) < 3) {
            hoverColor = buildAccessibleInteractiveColor(baseBrand, background, secondaryDirection, 3);
        }
        let activeColor = buildAccessibleInteractiveColor(
            primaryDirection === 'light' ? darkenRgb(hoverColor, 0.18) : mixRgb(hoverColor, { r: 0, g: 0, b: 0 }, 0.18),
            background,
            primaryDirection,
            3.4
        );
        if (getContrastRatio(background, activeColor) < 3.4) {
            activeColor = buildAccessibleInteractiveColor(hoverColor, background, secondaryDirection, 3.4);
        }
        return { hoverColor, activeColor };
    };
    const applyMenuBgSetting = (house, barEl, menuBar, menuTopLayout, sameRowLayout) => {
        if (!menuBar) return;
        const mode = house?.color_settings?.menu_bg_mode || 'auto';
        if (sameRowLayout) {
            if (barEl) { barEl.style.backgroundSize = ''; barEl.style.backgroundPosition = ''; barEl.style.backgroundRepeat = ''; }
            menuBar.style.backgroundSize = '';
            menuBar.style.backgroundPosition = '';
            menuBar.style.backgroundRepeat = '';
            if (mode === 'solid') {
                const color = house?.color_settings?.menu_bg_color || '#ffffff';
                menuBar.style.background = color;
                menuBar.style.borderBottom = 'none';
                menuBar.style.boxShadow = '0 1px 6px rgba(0,0,0,0.08)';
            } else if (mode === 'page-bg') {
                const pageColor = document.body.style.backgroundColor ||
                    window.getComputedStyle(document.body).backgroundColor || '#ffffff';
                menuBar.style.background = pageColor;
                menuBar.style.borderBottom = 'none';
                menuBar.style.boxShadow = '0 1px 6px rgba(0,0,0,0.08)';
            } else {
                menuBar.style.background = 'transparent';
                menuBar.style.borderBottom = 'none';
                menuBar.style.boxShadow = 'none';
            }
        } else {
            if (mode === 'header') {
                const headerBg = getHeaderBackgroundForMenu(house, barEl);
                const hh = barEl ? (barEl.offsetHeight || parseInt(barEl.style.height, 10) || 70) : 70;
                const menuH = menuBar.offsetHeight || 36;
                const totalH = hh + menuH;
                if (menuTopLayout) {
                    menuBar.style.background = headerBg;
                    menuBar.style.backgroundSize = `100% ${totalH}px`;
                    menuBar.style.backgroundPosition = '0 0';
                    menuBar.style.backgroundRepeat = 'no-repeat';
                    if (barEl) {
                        barEl.style.backgroundSize = `100% ${totalH}px`;
                        barEl.style.backgroundPosition = `0 -${menuH}px`;
                        barEl.style.backgroundRepeat = 'no-repeat';
                    }
                } else {
                    menuBar.style.background = headerBg;
                    menuBar.style.backgroundSize = `100% ${totalH}px`;
                    menuBar.style.backgroundPosition = `0 -${hh}px`;
                    menuBar.style.backgroundRepeat = 'no-repeat';
                    if (barEl) {
                        barEl.style.backgroundSize = `100% ${totalH}px`;
                        barEl.style.backgroundPosition = '0 0';
                        barEl.style.backgroundRepeat = 'no-repeat';
                    }
                }
                menuBar.style.borderBottom = 'none';
                menuBar.style.boxShadow = 'none';
            } else {
                if (mode === 'transparent') {
                    menuBar.style.background = 'transparent';
                    menuBar.style.backgroundSize = '';
                    menuBar.style.backgroundPosition = '';
                    menuBar.style.backgroundRepeat = '';
                    menuBar.style.borderBottom = 'none';
                    menuBar.style.boxShadow = 'none';
                    if (barEl) { barEl.style.backgroundSize = ''; barEl.style.backgroundPosition = ''; barEl.style.backgroundRepeat = ''; }
                } else {
                    const solidColor = house?.color_settings?.menu_bg_color || '#ffffff';
                    menuBar.style.background = solidColor;
                    menuBar.style.backgroundSize = '';
                    menuBar.style.backgroundPosition = '';
                    menuBar.style.backgroundRepeat = '';
                    menuBar.style.borderBottom = '1px solid #eee';
                    menuBar.style.boxShadow = '';
                    if (barEl) { barEl.style.backgroundSize = ''; barEl.style.backgroundPosition = ''; barEl.style.backgroundRepeat = ''; }
                }
            }
        }
    };

    const applyMenuColorTheme = (house) => {
        if (!menuBar) return;
        const barEl = document.getElementById('street-bar');
        const layout = house?.menuSettings?.layout || 'logo-top';
        const sameRowLayout = layout === 'same-row';
        const menuTopLayout = layout === 'menu-top';
        const isSameRowTransparent = sameRowLayout && (house?.color_settings?.menu_bg_mode === 'transparent');
        applyMenuBgSetting(house, barEl, menuBar, menuTopLayout, sameRowLayout);
        if (isSameRowTransparent) {
            window.requestAnimationFrame(() => {
                if (menuBar) menuBar.style.visibility = 'visible';
            });
        } else {
            menuBar.style.visibility = 'visible';
        }
        if (barEl) {
            const _hdrBgVal = getHeaderBackgroundForMenu(house, barEl);
            const _hdrGrad = parseLinearGradientValue(_hdrBgVal);
            const _btnRgb = _hdrGrad
                ? sampleGradientColorAtPoint(_hdrGrad, 0.85, 0.5)
                : (parseCssColorToRgb(_hdrBgVal) || parseCssColorToRgb(window.getComputedStyle(barEl).backgroundColor) || parseHexColor('#f39c12'));
            const _isLight = getRelativeLuminance(_btnRgb) > 0.42;
            const _btnColor = _isLight ? '#111827' : '#ffffff';
            const _btnBgNormal = _isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)';
            const _btnBgHover = _isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.30)';
            const _userBtn = barEl.querySelector('#st-user-button');
            if (_userBtn) {
                _userBtn.style.color = _btnColor;
                _userBtn.style.background = _btnBgNormal;
                barEl.style.setProperty('--st-header-btn-hover-bg', _btnBgHover);
            }
        }
        if (!barEl || menuBar.style.display === 'none') {
            menuBar.style.removeProperty('--st-menu-text-color');
            menuBar.style.removeProperty('--st-menu-hover-color');
            menuBar.style.removeProperty('--st-menu-active-color');
            return;
        }
        const rawMenuBgMode = house?.color_settings?.menu_bg_mode || 'solid';
        const menuBgMode = sameRowLayout && rawMenuBgMode === 'transparent' ? 'transparent' : (rawMenuBgMode === 'transparent' ? 'solid' : rawMenuBgMode);
        if (house?.color_settings && !sameRowLayout && rawMenuBgMode === 'transparent') {
            house.color_settings.menu_bg_mode = 'solid';
            if (!house.color_settings.menu_bg_color) house.color_settings.menu_bg_color = '#ffffff';
        }
        let backgroundValue;
        let samplePoint;
        if (sameRowLayout) {
            backgroundValue = getHeaderBackgroundForMenu(house, barEl);
            samplePoint = getHeaderSamplePoint(barEl, menuBar);
        } else if (menuBgMode === 'header' || menuBgMode === 'transparent') {
            backgroundValue = getHeaderBackgroundForMenu(house, barEl);
            samplePoint = { x: 0.5, y: 0.5 };
        } else {
            backgroundValue = house?.color_settings?.menu_bg_color || '#ffffff';
            samplePoint = { x: 0.5, y: 0.5 };
        }
        const gradient = parseLinearGradientValue(backgroundValue);
        const sampledBackground = gradient
            ? sampleGradientColorAtPoint(gradient, samplePoint.x, samplePoint.y)
            : (parseCssColorToRgb(backgroundValue) || parseCssColorToRgb(window.getComputedStyle(barEl).backgroundColor) || parseHexColor('#ffffff'));
        const logoElement = barEl.querySelector('.st-house-name');
        const logoRgb = logoElement ? parseCssColorToRgb(window.getComputedStyle(logoElement).color) : null;
        const menuBase = pickMenuBaseColor({
            backgroundRgb: sampledBackground,
            logoRgb,
            mode: getMenuToneSetting(house)
        });
        const interactiveColors = buildMenuInteractiveColors(
            parseCssColorToRgb(house?.color_settings?.body_main_color || currentAccent || house?.site_color || '#ff6600') || parseHexColor('#ff6600'),
            sampledBackground
        );
        menuBar.style.setProperty('--st-menu-text-color', rgbToCss(menuBase));
        menuBar.style.setProperty('--st-menu-hover-color', rgbToCss(interactiveColors.hoverColor));
        menuBar.style.setProperty('--st-menu-active-color', rgbToCss(interactiveColors.activeColor));
    };

    const ensureProductSourceStyles = () => {
        if (document.getElementById('st-ps-style')) return;
        const style = document.createElement('style');
        style.id = 'st-ps-style';
        style.textContent = `
.st-product-source{padding:12px 0;}
.st-ps-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 12px;}
.st-ps-item{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;cursor:pointer;transition:box-shadow .15s;}
.st-ps-item:hover{box-shadow:0 4px 14px rgba(0,0,0,.1);}
.st-ps-thumb{height:120px;background:#f8fafc;overflow:hidden;}
.st-ps-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.st-ps-info{padding:8px 10px;}
.st-ps-name{font-size:12px;font-weight:600;color:#0f172a;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4;margin-bottom:4px;}
.st-ps-price{font-size:12px;font-weight:700;color:#0369a1;}
.st-ps-pagination{display:flex;align-items:center;justify-content:center;gap:6px;padding:14px 12px 4px;flex-wrap:wrap;}
.st-ps-page-btn{min-width:34px;height:34px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#334155;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s;}
.st-ps-page-btn:hover:not(.active){background:#f1f5f9;}
.st-ps-page-btn.active{background:#0369a1;color:#fff;border-color:#0369a1;}
`;
        document.head.appendChild(style);
    };

    const setupProductSourceSections = () => {
        ensureProductSourceStyles();
        document.querySelectorAll('.st-section.st-product-source').forEach(section => {
            if (section.dataset.psInit === '1') return;
            section.dataset.psInit = '1';
            const perPage = parseInt(section.dataset.psPerPage) || 6;
            const items = Array.from(section.querySelectorAll('.st-ps-item'));
            if (!items.length) return;
            const goToPage = (page) => {
                const start = (page - 1) * perPage;
                const end = start + perPage;
                items.forEach((item, idx) => {
                    item.style.display = (idx >= start && idx < end) ? '' : 'none';
                });
                section.querySelectorAll('.st-ps-page-btn').forEach(btn => {
                    btn.classList.toggle('active', parseInt(btn.dataset.page) === page);
                });
            };
            goToPage(1);
            section.querySelectorAll('.st-ps-page-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    goToPage(parseInt(btn.dataset.page));
                });
            });
        });
    };

    const renderSection = (section, houseName, houseSlogan, accent, pageId = '', sectionIndex = 0) => {
        ensureSectionId(section);
        const defImg = drawMosaicSvgBase64(houseName);
        const sectionStyle = buildSectionStyle(section);
        const newClass = section.__new ? ' st-new-section' : '';
        const dataAttrs = `data-section-type="${section.type}" data-section-page="${pageId}" data-section-index="${sectionIndex}" data-section-id="${escapeHtml(section.id)}"`;
        switch(section.type) {
            case 'text': {
                const sectionTitle = escapeHtml(getSectionTitle(section));
                const rawSectionText = getSectionText(section);
                const sectionText = sanitizeTextSectionHtml(rawSectionText);
                const hasTitle = Boolean(sectionTitle);
                const titleHtml = `<h3 class="st-text-title${hasTitle ? '' : ' st-text-title-empty'}" data-placeholder="Nhập tiêu đề (không bắt buộc)">${sectionTitle}</h3>`;
                const hasContent = Boolean(String(rawSectionText || '').replace(/<[^>]*>/g, '').trim());
                const contentClass = hasContent ? 'st-text-content' : 'st-text-content st-text-content-empty';
                const contentHtml = `<div class="${contentClass}" data-placeholder="Nội dung mô tả mới. Bạn có thể chỉnh sửa nội dung này ngay lập tức.">${sectionText}</div>`;
                const sectionClass = ` st-text${hasTitle ? ' has-title' : ''}${!sectionTitle && !hasContent ? ' st-text-empty' : ''}${newClass}`;
                return `<div class="st-section${sectionClass}" ${dataAttrs} style="${sectionStyle}; padding:24px;">${titleHtml}${contentHtml}</div>`;
            }
            case 'image':
                return `<div class="st-section${newClass}" ${dataAttrs} style="${sectionStyle}"><img src="${section.src}" class="st-image" onerror="this.onerror=null; this.src='${defImg}'" style="max-width:100%; width:auto; height:auto; display:block; margin:0 auto;"></div>`;
            case 'line':
                return `<div class="st-section${newClass}" ${dataAttrs} style="${sectionStyle}"><hr style="border:0;border-top:1px solid #eee"></div>`;
            case 'button': 
                return `<div class="st-section${newClass}" ${dataAttrs} style="${sectionStyle}">
                    <a href="${section.url}" target="_blank" class="st-btn-link" style="background:${accent}">
                        ${escapeHtml(String(section.label || '').toUpperCase())}
                    </a>
                </div>`;
            case 'youtube':
                if (!section.url) {
                    return `<div class="st-section st-text" style="${sectionStyle}; color:#e53e3e;">URL YouTube chưa được nhập</div>`;
                }
                const m = (section.url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
                if (!m) {
                    return `<div class="st-section st-text" style="${sectionStyle}; color:#e53e3e;">URL YouTube không hợp lệ</div>`;
                }
                return `<div class="st-section" style="${sectionStyle}"><iframe width="100%" height="200" src="https://www.youtube.com/embed/${m[1]}" frameborder="0" allowfullscreen></iframe></div>`;
            case 'hero':
                const heroTitle = escapeHtml((section.content && section.content.title) ? section.content.title : houseName);
                const heroAvatar = escapeHtml((section.content && typeof section.content.avatar === 'string') ? section.content.avatar : '');
                const heroAvatarHtml = heroAvatar ? `<img class="st-hero-avatar" src="${heroAvatar}" alt="Ảnh đại diện" />` : '';
                const heroSubtitle = escapeHtml((section.content && typeof section.content.subtitle === 'string') ? section.content.subtitle : '');
                const heroSubtitleHtml = heroSubtitle !== '' ? `<p class="st-page-slogan" style="margin:0; font-size:1rem; color:#4a5568;">${heroSubtitle}</p>` : `<p class="st-page-slogan" style="margin:0; font-size:1rem; color:#4a5568;"></p>`;
                return `<div class="st-section st-hero${newClass}" ${dataAttrs} style="${sectionStyle}; text-align:center; padding:40px 20px;">
                    ${heroAvatarHtml}
                    <h1 class="st-hero-title" style="margin:0 0 14px; font-size:2.2rem; line-height:1.05; color:${accent};">${heroTitle}</h1>
                    ${heroSubtitleHtml}
                </div>`;
            case 'product': {
                const product = getProductDataForSection(section, currentHouse);
                const productImages = getProductImageList(product);
                const layoutConfig = getProductLayoutConfig(section, section.__compactGrouped ? { compactGrouped: true } : {});
                const productVariant = layoutConfig.variant;
                const image = productImages[0] || '';
                const extraImageCount = productImages.length > 1 ? productImages.length - 1 : 0;
                const title = escapeHtml(product?.title || 'Sản phẩm mẫu');
                const rawPrice = String(product?.price || '1.200.000đ');
                const priceMatch = rawPrice.match(/^([\d\.,\s]+)(.*)$/);
                const priceAmountRaw = priceMatch ? priceMatch[1].trim() : rawPrice;
                const priceAmount = formatPriceAmount(priceAmountRaw);
                const priceUnit = escapeHtml(priceMatch ? priceMatch[2].trim() : '');
                const priceHtml = priceUnit
                    ? `<span class="st-product-price-amount">${priceAmount}</span><span class="st-product-price-unit">${priceUnit}</span>`
                    : `<span class="st-product-price-amount">${priceAmount}</span>`;
                const description = escapeHtml(product?.description || 'Mô tả ngắn gọn sản phẩm, điểm nổi bật và ưu đãi hiện tại.');
                const phone = product?.phone || '';
                const zalo = product?.zalo || '';
                const phoneUrl = phone ? `tel:${phone}` : '#';
                const zaloUrl = zalo ? `https://zalo.me/${String(zalo).replace(/\D/g, '')}` : '#';
                const buttonLabel = escapeHtml(product?.buttonLabel || 'Gọi điện thoại');
                const imageHtml = image ? `<button type="button" class="st-product-gallery-trigger st-product-layout-media" data-product-gallery-trigger="1" data-page-id="${pageId}" data-section-index="${sectionIndex}" data-product-variant="${productVariant}" style="${layoutConfig.imageStyle}"><img src="${image}" alt="${title}" style="width:100%;height:100%;object-fit:cover;display:block;" />${extraImageCount > 0 ? `<span style="position:absolute;right:10px;bottom:10px;z-index:3;padding:4px 8px;border-radius:999px;background:rgba(15,23,42,0.72);color:#fff;font-size:12px;font-weight:600;line-height:1;pointer-events:none;backdrop-filter:blur(4px);">+${extraImageCount} ảnh</span>` : ''}</button>` : '';
                const contentFlex = image ? layoutConfig.contentStyle : 'width:100%; display:flex;flex-direction:column; gap:12px;';
                const actionButtons = [];
                if (phone && layoutConfig.showActions !== false) {
                    actionButtons.push(`<a href="${phoneUrl}" class="st-btn-link" style="background:${accent};min-width:140px;">${buttonLabel}</a>`);
                }
                if (zalo && layoutConfig.showActions !== false) {
                    actionButtons.push(`<a href="${zaloUrl}" class="st-btn-link" style="background:#2d8cff;min-width:140px;">Chat Zalo</a>`);
                }
                const actionsHtml = (layoutConfig.showActions !== false && actionButtons.length) ? `<div class="st-product-layout-actions" style="${layoutConfig.actionsStyle}">${actionButtons.join('')}</div>` : '';
                const descriptionHtml = (layoutConfig.showDescription !== false && description) ? `<div class="st-product-description">${description}</div>` : '';
                const detailLinkHtml = `<button type="button" class="st-product-detail-link" data-product-detail="1" data-page-id="${pageId}" data-section-index="${sectionIndex}">Xem chi tiết</button>`;
                const groupedClass = section.__compactGrouped ? ' st-product-compact-grouped' : '';
                return `<div class="st-section st-product st-product-layout-${productVariant}${groupedClass}${newClass}" ${dataAttrs} data-product-variant="${productVariant}" style="${sectionStyle}; ${layoutConfig.rootStyle}">
                    <div class="st-product-layout-shell" style="${layoutConfig.rowStyle}">
                        ${imageHtml}
                        <div class="st-product-layout-content" style="${contentFlex}">
                            <div class="st-product-layout-head">
                                <h3 class="st-product-title">${title}</h3>
                                <div class="st-product-price" style="${layoutConfig.priceStyle}">${priceHtml}</div>
                            </div>
                            ${descriptionHtml}
                            ${actionsHtml}
                            ${detailLinkHtml}
                        </div>
                    </div>
                </div>`;
            }
            case 'product_source': {
                ensureProductSourceStyles();
                const pool = Array.isArray(currentHouse?.product_pool) ? currentHouse.product_pool : [];
                const sourceCats = Array.isArray(section.source?.categoryIds) ? section.source.categoryIds : [];
                let filtered = pool;
                if (sourceCats.length > 0) {
                    filtered = pool.filter(p => {
                        const pCats = Array.isArray(p.category_ids) && p.category_ids.length > 0
                            ? p.category_ids
                            : (p.category_id ? [{ catId: p.category_id, subId: p.subcategory_id || '' }] : []);
                        if (!pCats.length) return false;
                        return pCats.some(pc => {
                            const match = sourceCats.find(sc => sc.catId === pc.catId);
                            if (!match) return false;
                            if (!Array.isArray(match.subIds) || !match.subIds.length) return true;
                            return match.subIds.includes(pc.subId || '');
                        });
                    });
                }
                const perPage = Math.max(1, parseInt(section.layout?.itemsPerPage) || 6);
                const totalPages = Math.ceil(filtered.length / perPage) || 1;
                const cards = filtered.map((p, idx) => {
                    const img = (Array.isArray(p.images) ? p.images.filter(Boolean)[0] : '') || p.image || '';
                    const title = escapeHtml(p.title || 'Sản phẩm');
                    const rawPrice = String(p.price || '');
                    const priceMatch = rawPrice.match(/^([\d\.,\s]+)(.*)$/);
                    const priceAmount = priceMatch ? formatPriceAmount(priceMatch[1].trim()) : '';
                    const priceUnit = priceMatch ? escapeHtml(priceMatch[2].trim()) : '';
                    const imgHtml = img
                        ? `<img src="${img}" alt="${title}" style="width:100%;height:100%;object-fit:cover;display:block;">`
                        : `<div style="width:100%;height:100%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:28px;">🛍️</div>`;
                    return `<div class="st-ps-item" data-ps-index="${idx}">
                        <div class="st-ps-thumb">${imgHtml}</div>
                        <div class="st-ps-info">
                            <div class="st-ps-name">${title}</div>
                            ${priceAmount ? `<div class="st-ps-price">${priceAmount}${priceUnit}</div>` : ''}
                        </div>
                    </div>`;
                }).join('');
                const emptyHtml = !filtered.length
                    ? `<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:32px 0;font-size:14px;">Không có sản phẩm nào</div>`
                    : '';
                const pageButtons = totalPages > 1
                    ? Array.from({length: totalPages}, (_, i) => `<button type="button" class="st-ps-page-btn" data-page="${i+1}">${i+1}</button>`).join('')
                    : '';
                return `<div class="st-section st-product-source${newClass}" ${dataAttrs} data-ps-per-page="${perPage}" data-ps-total="${filtered.length}" style="${sectionStyle}">
                    <div class="st-ps-grid">${cards}${emptyHtml}</div>
                    ${totalPages > 1 ? `<div class="st-ps-pagination">${pageButtons}</div>` : ''}
                </div>`;
            }
            case 'banner': {
                const bannerImage = section.image || 'https://via.placeholder.com/1200x360?text=Banner+mới';
                const bannerText = escapeHtml(section.text || 'Banner nổi bật mới');
                return `<div class="st-section st-banner${newClass}" ${dataAttrs} style="${sectionStyle}; position:relative; overflow:hidden; border-radius:18px;">
                    <img src="${bannerImage}" alt="Banner" style="width:100%;height:auto;display:block;object-fit:cover;" />
                    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.4)); display:flex;align-items:center;justify-content:center;padding:20px;">
                        <div style="color:#fff;font-size:1.4rem;font-weight:600;text-align:center;">${bannerText}</div>
                    </div>
                </div>`;
            }
            default: return '';
        }
    };

    const showPage = (pageId, options = {}) => {
        const { updateUrl = true, replaceUrl = false, allowHidden = false } = options;
        const house = currentHouse;
        const template = document.getElementById('house-template');
        const footerHost = document.getElementById('st-footer-host');
        if (!template || !house.pages) {
            if (footerHost) footerHost.innerHTML = '';
            return;
        }

        const visiblePages = house.pages.filter(p => !isMenuPageHidden(p));
        const requestedPage = house.pages.find(p => p.id === pageId) || null;
        const page = (requestedPage && (!isMenuPageHidden(requestedPage) || allowHidden)) ? requestedPage : (visiblePages[0] || null);

        if (!page) {
            currentPageIdx = -1;
            template.innerHTML = '';
            if (footerHost) footerHost.innerHTML = '';
            renderMenuPanel(house);
            return;
        }

        normalizePageSectionIds(page);
        currentPageIdx = house.pages.indexOf(page);
        document.querySelectorAll('.st-menu-item').forEach(el => el.classList.toggle('active', el.dataset.id === page.id));
        if (updateUrl) {
            syncPageIdToUrl(page.id, replaceUrl);
        }

        let html = '';
        for (let idx = 0; idx < page.sections.length; idx += 1) {
            const section = page.sections[idx];
            const isCompactProduct = section?.type === 'product' && section?.layout?.variant === 'compact';

            if (isCompactProduct) {
                let endIdx = idx;
                while (endIdx < page.sections.length) {
                    const currentSection = page.sections[endIdx];
                    const currentIsCompactProduct = currentSection?.type === 'product' && currentSection?.layout?.variant === 'compact';
                    if (!currentIsCompactProduct) break;
                    endIdx += 1;
                }

                const runLength = endIdx - idx;
                if (runLength >= 2) {
                    html += `<div class="st-product-compact-grid">`;
                    for (let compactIdx = idx; compactIdx < endIdx; compactIdx += 1) {
                        const compactSection = page.sections[compactIdx];
                        compactSection.__compactGrouped = true;
                        html += renderSection(compactSection, house.store_info.name, house.store_info.slogan, currentAccent, page.id, compactIdx);
                        delete compactSection.__compactGrouped;
                    }
                    html += `</div>`;
                    idx = endIdx - 1;
                    continue;
                }
            }

            html += renderSection(section, house.store_info.name, house.store_info.slogan, currentAccent, page.id, idx);
        }
        const footerHtml = buildFooterMarkup(house);
        html = `<div class="st-page-surface">${html}</div>`;

        const isSameRowTransparent = (house?.menuSettings?.layout === 'same-row') && (house?.color_settings?.menu_bg_mode === 'transparent');
        if (isSameRowTransparent) {
            menuBar.style.visibility = 'hidden';
            menuBar.style.background = 'transparent';
            menuBar.style.backgroundSize = '';
            menuBar.style.backgroundPosition = '';
            menuBar.style.backgroundRepeat = '';
            menuBar.style.borderBottom = 'none';
            menuBar.style.boxShadow = 'none';
        }

        template.innerHTML = html;
        setupProductSourceSections();
        if (footerHost) {
            footerHost.innerHTML = footerHtml;
        }
        if (window.refreshNewSectionUI) {
            window.refreshNewSectionUI();
        }
        if (typeof window.setupFloatingActionsForSections === 'function') {
            setTimeout(() => window.setupFloatingActionsForSections(), 0);
        }

        // Add top-right preview badge in preview mode
        if (isPreviewMode && !document.getElementById('st-preview-badge')) {
            const previewMeta = PREVIEW_META || { house_id: legacyPreviewHouseId, created_at: PREVIEW_META?.created_at || '' };
            const previewDate = (previewMeta.created_at || '').replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1');
            const previewBadge = document.createElement('div');
            previewBadge.id = 'st-preview-badge';
            previewBadge.style.cssText = 'position:fixed;bottom:12px;right:12px;background:rgba(255,234,175,0.95);color:#846404;z-index:100012;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 5px 18px rgba(0,0,0,0.12);pointer-events:none;';
            previewBadge.innerText = `Xem trước web` + (previewDate ? ` ngày ${previewDate}` : '');
            document.body.appendChild(previewBadge);
        }

        renderMenuPanel(house);
        window.scrollTo(0, 0);
    };


    // Mobile action buttons handlers
    let currentPageIdx = 0;

    const handlePrevPage = () => {
        // Removed: page navigation disabled
    };

    const handleNextPage = () => {
        // Removed: page navigation disabled
    };

    const openMenuPanel = () => {
        const overlay = document.getElementById('st-menu-panel-overlay');
        const panel = document.getElementById('st-menu-panel');
        if (overlay && panel) {
            overlay.style.display = 'block';
            panel.classList.add('open');
            lockBodyScroll();
        }
    };

    const closeMenuPanel = () => {
        const overlay = document.getElementById('st-menu-panel-overlay');
        const panel = document.getElementById('st-menu-panel');
        if (overlay && panel) {
            overlay.style.display = 'none';
            panel.classList.remove('open');
            unlockBodyScroll();
        }
    };

    const handleToggleMenu = () => {
        const isHamburger = currentHouse?.menuSettings?.mobile_mode === 'hamburger';
        if (isHamburger && window.innerWidth <= 768) {
            const panel = document.getElementById('st-menu-panel');
            if (!panel) return;
            if (panel.classList.contains('open')) {
                closeMenuPanel();
            } else {
                openMenuPanel();
            }
            return;
        }

        const menu = document.getElementById('st-menu');
        if (menu) {
            const isHidden = menu.style.display === 'none';
            menu.style.display = isHidden ? 'flex' : 'none';
            
            // Adjust body padding on mobile when menu is shown
            if (window.innerWidth <= 768) {
                const barEl = document.getElementById('street-bar');
                const hh = barEl ? (barEl.offsetHeight || parseInt(barEl.style.height, 10) || 70) : 70;
                // after toggling, menu may be visible; read its height
                const menuPadding = menu.offsetHeight || 0;
                const isStickyNow = barEl && (barEl.style.position === 'fixed');
                if (isHidden) {
                    // menu is now shown
                    if (isStickyNow) {
                        document.body.style.paddingTop = `${hh + menuPadding}px`;
                    } else {
                        document.body.style.paddingTop = '0px';
                    }
                } else {
                    // menu hidden
                    if (isStickyNow) {
                        document.body.style.paddingTop = `${hh}px`;
                    } else {
                        document.body.style.paddingTop = '0px';
                    }
                }
            }
        }
    };

    const isMenuPageHidden = (page) => {
        // If host login known and true, treat hidden pages as visible for logged-in users
        if (window.__STREET_HOST_LOGGED_IN === true) return false;
        return page?.hidden === true || page?.hidden === 'true' || page?.hidden === 1 || page?.hidden === '1';
    };

    const renderMenuPanel = (house) => {
        const listWrapper = document.getElementById('st-menu-panel-list');
        if (!listWrapper || !house.pages) return;
        const visiblePages = house.pages.filter(page => !isMenuPageHidden(page));
        const activePageId = house.pages[currentPageIdx]?.id;
        listWrapper.innerHTML = visiblePages.map((p) => `
            <a class="st-menu-item ${p.id===activePageId?'active':''}" data-id="${p.id}" href="javascript:void(0)">${p.label}</a>
        `).join('');
        listWrapper.querySelectorAll('.st-menu-item').forEach(el => {
            el.onclick = () => {
                showPage(el.dataset.id);
                closeMenuPanel();
            };
        });
    };

    let actionsFullScreenState = false;

    const handleToggleFullScreen = () => {
        const template = document.getElementById('house-template');
        if (!template) return;

        actionsFullScreenState = !actionsFullScreenState;
        const btn = document.getElementById('st-action-full');

        if (actionsFullScreenState) {
            template.style.cssText = 'position:fixed !important; inset:0 !important; z-index:99997 !important; overflow-y:auto !important; width:100% !important;';
            if (btn) btn.classList.add('active');
        } else {
            template.style.cssText = '';
            if (btn) btn.classList.remove('active');
        }
    };

    const updateActionButtonStates = () => {
        // Removed: prev/next buttons no longer exist
    };

    const renderActionsBar = () => {
        const actions = document.getElementById('st-actions');
        if (!actions) return;

        const showMenuButton = currentHouse?.pages && currentHouse.pages.length > 0;
        actions.innerHTML = `
            ${showMenuButton ? `
            <button id="st-action-menu" class="st-action-btn" onclick="window.stToggleMenu()" title="Menu">
                <span>☰</span>
                <span>Menu</span>
            </button>
            ` : ''}
            <button id="st-action-full" class="st-action-btn" onclick="window.stToggleFull()" title="Xem Full">
                <span>⛶</span>
                <span>Full</span>
            </button>
        `;
    };

    // Page navigation disabled - removed stPrevPage and stNextPage
    window.stToggleMenu = handleToggleMenu;
    window.stToggleFull = handleToggleFullScreen;

    const ensureFloatingEditButton = () => {
        if (document.getElementById('st-floating-edit-btn')) return;
        
        // Create floating button
        const floatingBtn = document.createElement('button');
        floatingBtn.id = 'st-floating-edit-btn';
        floatingBtn.type = 'button';
        floatingBtn.title = 'Sửa';
        floatingBtn.textContent = '✏️';
        floatingBtn.style.display = 'none';
        floatingBtn.addEventListener('click', toggleEditModeFromRow);
        document.body.appendChild(floatingBtn);
        
        // Create edit mode bar
        const editBar = document.createElement('div');
        editBar.id = 'st-edit-mode-bar';
        editBar.innerHTML = `
            <div class="label">ĐANG CHỈNH SỬA</div>
            <div class="actions">
                <button type="button" class="add-btn" title="Thêm">+ Thêm</button>
                <button type="button" class="save" title="Lưu">💾 Lưu</button>
                <button type="button" class="exit" title="Thoát">✕ Thoát</button>
            </div>
        `;
        document.body.appendChild(editBar);
        
        // Setup edit bar button listeners
        const addBtn = editBar.querySelector('.add-btn');
        const saveBtn = editBar.querySelector('.save');
        const exitBtn = editBar.querySelector('.exit');
        
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof window.toggleEditRowAddDropdown === 'function') {
                    window.toggleEditRowAddDropdown(addBtn);
                } else if (typeof window.openEditRowAddDropdown === 'function') {
                    window.openEditRowAddDropdown(addBtn);
                }
            });
        }
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (typeof window.openLiveSaveMenu === 'function') {
                    window.openLiveSaveMenu();
                }
            });
        }
        
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                setLiveUpdateMode(false);
                updateFloatingEditButtonState();
            });
        }
    };

    const updateFloatingEditButtonState = (isLoggedIn = true) => {
        const floatingBtn = document.getElementById('st-floating-edit-btn');
        const editBar = document.getElementById('st-edit-mode-bar');

        if (!isLoggedIn) {
            if (floatingBtn) floatingBtn.style.display = 'none';
            if (editBar) {
                editBar.classList.remove('active');
                document.body.classList.remove('st-edit-mode-active');
            }
            if (currentHouse) updateMenuLayout(currentHouse);
            return;
        }
        
        if (liveUpdateMode) {
            if (floatingBtn) floatingBtn.style.display = 'none';
            if (editBar) {
                editBar.classList.add('active');
                document.body.classList.add('st-edit-mode-active');
            }
        } else {
            if (floatingBtn) floatingBtn.style.display = 'flex';
            if (editBar) {
                editBar.classList.remove('active');
                document.body.classList.remove('st-edit-mode-active');
            }
        }
        // Recalculate header/menu/content positions based on current edit bar state
        if (currentHouse) updateMenuLayout(currentHouse);
    };

    const refreshFloatingEditButtonVisibility = async (forcedLoggedIn) => {
        const isLoggedIn = typeof forcedLoggedIn === 'boolean'
            ? forcedLoggedIn
            : await checkHostLoginState();

        if (!isLoggedIn && liveUpdateMode) {
            setLiveUpdateMode(false);
            return;
        }

        updateFloatingEditButtonState(isLoggedIn);
    };

    const renderHouse = (infra, house, registry) => {
        currentHouse = house; currentInfra = infra;
        currentRegistry = Array.isArray(registry) ? registry : (registry.houses || []);
        availableBuilders = (registry && registry.builders) ? registry.builders : [];

        // Ensure house has id field for consistency
        if (house.house_id && !house.id) {
            house.id = house.house_id;
        }

        if (!house.pages || !house.pages.length) {
            house.pages = [{
                id: 'home',
                label: 'Home',
                sections: [
                    { type: 'text', content: house.store_info?.slogan || 'Chào mừng đến cửa tiệm.' },
                ]
            }];
        }

        currentAccent = house.color_settings?.body_main_color || house.site_color || infra.ui_settings.accent_color || '#ff6600';
        document.body.style.setProperty('--accent', currentAccent);
        const mobileMode = house.menuSettings?.mobile_mode || 'scroll';
        const isMobileScreen = window.innerWidth <= 768;
        const hamburgerButton = mobileMode === 'hamburger' ? `<button id="st-hamburger-toggle" class="st-btn" style="background:rgba(255,255,255,0.2);font-size:14px;">☰</button>` : '';
        bar.style.backgroundColor = infra.ui_settings.bar_bg || currentAccent;
        bar.innerHTML = `
            <div class="st-bar-left">
                ${hamburgerButton}
                <div class="st-store-info"><span class="st-house-name">${house.store_info.name}</span></div>
            </div>
            <div class="st-btn-group">
                <button id="st-user-button" class="st-btn" style="background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.2s ease;" title="Tài khoản"><svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;display:block;">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg></button>
            </div>
        `;

        // Make the site logo (house name) clickable and navigate to the homepage
        try {
            const logoEl = bar.querySelector('.st-house-name');
            if (logoEl) {
                logoEl.style.cursor = 'pointer';
                logoEl.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const homePageId = (house.pages && house.pages[0] && house.pages[0].id) ? house.pages[0].id : '';
                    if (homePageId && typeof showPage === 'function') {
                        showPage(homePageId);
                    } else if (typeof window.location !== 'undefined') {
                        window.location.href = STREET_ROOT || '/';
                    }
                });
            }
        } catch (e) {
            console.error('Failed to bind logo click:', e);
        }

        if (currentHouse) {
            const houseId = currentHouse.id || currentHouse.house_id || 'default';
            const houseKey = 'house_' + houseId;
            const colorSettings = currentHouse.color_settings || {};
            const headerColor = colorSettings.header_color || currentHouse.header_background || currentHouse.site_color || localStorage.getItem(houseKey + '_header_color');
            if (headerColor && bar) {
                bar.style.background = headerColor;
                if (!colorSettings.header_color) localStorage.setItem(houseKey + '_header_color', headerColor);
            }
            const rawHeaderHeight = colorSettings.header_height || parseInt(localStorage.getItem(houseKey + '_header_height'), 10) || '';
            let hh = parseInt(rawHeaderHeight, 10) || 0;
            if (!hh) hh = 70; // fallback default
            hh = Math.max(50, Math.min(180, hh));
            if (bar) bar.style.height = hh + 'px';
            // sticky setting
            const rawHeaderSticky = (typeof colorSettings.header_sticky !== 'undefined') ? (colorSettings.header_sticky ? '1' : '0') : (localStorage.getItem(houseKey + '_header_sticky') || '1');
            const isSticky = (String(rawHeaderSticky) === '1' || String(rawHeaderSticky) === 'true');
            if (bar) {
                if (isSticky) {
                    const layout = currentHouse?.menuSettings?.layout || 'logo-top';
                    const menuPadding = menuBar ? (menuBar.style.display !== 'none' ? (menuBar.offsetHeight || 0) : 0) : 0;
                    bar.style.position = 'fixed';
                    bar.style.top = layout === 'menu-top' ? `${menuPadding}px` : '0';
                    bar.style.zIndex = '200700';
                    try {
                        document.body.style.paddingTop = (hh + menuPadding) + 'px';
                    } catch (e) {
                        document.body.style.paddingTop = '70px';
                    }
                } else {
                    bar.style.position = 'static';
                    bar.style.top = '';
                    bar.style.zIndex = '';
                    // ensure no extra top padding when header is in normal flow
                        document.body.style.paddingTop = '0px';
                }
            }
        }

        if (liveUpdateMode && typeof window.setInlineEditMode === 'function') {
            window.setInlineEditMode(true, currentHouse);
        }

        window.ensureUserPopupMenu?.();
        ensureFloatingEditButton();
        refreshFloatingEditButtonVisibility();
        updateAddButtonVisibility();
        const editToggleBtn = document.getElementById('st-edit-toggle-btn');
        const editCaptionBtn = document.getElementById('st-edit-caption-btn');
        if (editToggleBtn) {
            if (liveUpdateMode) editToggleBtn.classList.add('active');
            editToggleBtn.onclick = toggleEditModeFromRow;
        }
        if (editCaptionBtn) {
            editCaptionBtn.onclick = toggleEditModeFromRow;
        }
        const userBtn = document.getElementById('st-user-button');
        if (userBtn) {
            userBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                const isLoggedIn = await checkHostSessionForUserMenu();
                if (!isLoggedIn) {
                    await openHostLoginForUserMenu();
                    return;
                }
                window.toggleUserPopupMenu?.();
            });
        }

        if (!window.__stHostAuthListenerBound) {
            window.addEventListener(HOST_AUTH_CHANGED_EVENT, (event) => {
                const loggedIn = event.detail?.loggedIn === true;
                updateAddButtonVisibility();
                refreshFloatingEditButtonVisibility(loggedIn);
            });
            window.__stHostAuthListenerBound = true;
        }

        // Load saved color settings on page load (from both server and localStorage)
        if (currentHouse) {
            const houseId = currentHouse.id || currentHouse.house_id || 'default';
            const houseKey = 'house_' + houseId;
            const colorSettings = currentHouse.color_settings || {};
            
            console.log('Loading colors for house:', houseId, 'colorSettings:', colorSettings);
            
            // Load body color (server first, then localStorage)
            const bodyColor = colorSettings.body_color || localStorage.getItem(houseKey + '_body_color');
            if (bodyColor) {
                document.body.style.backgroundColor = bodyColor;
                if (!colorSettings.body_color) localStorage.setItem(houseKey + '_body_color', bodyColor);
            }
            
            // Load body text color (server first, then localStorage)
            const bodyTextColor = colorSettings.body_text_color || localStorage.getItem(houseKey + '_body_text_color');
            if (bodyTextColor) {
                document.body.style.color = bodyTextColor;
                if (!colorSettings.body_text_color) localStorage.setItem(houseKey + '_body_text_color', bodyTextColor);
            }
            
            // Load body main color (server first, then localStorage)
            const bodyMainColor = colorSettings.body_main_color || localStorage.getItem(houseKey + '_body_main_color');
            if (bodyMainColor) {
                document.body.style.setProperty('--accent', bodyMainColor);
                document.documentElement.style.setProperty('--accent', bodyMainColor);
                if (!colorSettings.body_main_color) localStorage.setItem(houseKey + '_body_main_color', bodyMainColor);
            }
            
            // Load logo color (server first, then localStorage)
            const logoColor = colorSettings.logo_color || localStorage.getItem(houseKey + '_logo_color');
            if (logoColor) {
                const logoElement = document.querySelector('.st-house-name');
                if (logoElement) {
                    logoElement.style.color = logoColor;
                    if (!colorSettings.logo_color) localStorage.setItem(houseKey + '_logo_color', logoColor);
                }
            }
            
            // Load logo size (server first, then localStorage)
            const logoSize = colorSettings.logo_size || localStorage.getItem(houseKey + '_logo_size');
            if (logoSize) {
                const logoElement = document.querySelector('.st-house-name');
                if (logoElement) {
                    logoElement.style.fontSize = logoSize + 'px';
                    if (!colorSettings.logo_size) localStorage.setItem(houseKey + '_logo_size', logoSize);
                }
            }
            
            // Load logo position (server first, then localStorage)
            const headerLayout = currentHouse?.menuSettings?.layout || 'logo-top';
            const logoPosition = headerLayout === 'same-row'
                ? 'left'
                : (colorSettings.logo_position || localStorage.getItem(houseKey + '_logo_position'));
            if (logoPosition) {
                const storeInfo = document.querySelector('.st-store-info');
                if (storeInfo) {
                    const barLeft = storeInfo.closest('.st-bar-left');
                    if (barLeft) {
                        barLeft.style.flex = '1';
                        barLeft.style.minWidth = '0';
                    }
                    storeInfo.style.display = 'flex';
                    storeInfo.style.flexDirection = 'column';
                    if (logoPosition === 'center') {
                        storeInfo.style.position = 'absolute';
                        storeInfo.style.left = '50%';
                        storeInfo.style.top = '50%';
                        storeInfo.style.transform = 'translate(-50%, -50%)';
                        storeInfo.style.width = 'auto';
                        storeInfo.style.zIndex = '1';
                        storeInfo.style.flex = '0 0 auto';
                        storeInfo.style.minWidth = 'max-content';
                        storeInfo.style.textAlign = 'center';
                        storeInfo.style.alignItems = 'center';
                        storeInfo.style.justifyContent = 'center';
                    } else {
                        storeInfo.style.position = 'relative';
                        storeInfo.style.left = '';
                        storeInfo.style.top = '';
                        storeInfo.style.transform = '';
                        storeInfo.style.width = '';
                        storeInfo.style.zIndex = '';
                        storeInfo.style.flex = '1';
                        storeInfo.style.minWidth = '0';
                        storeInfo.style.textAlign = 'left';
                        storeInfo.style.alignItems = 'flex-start';
                        storeInfo.style.justifyContent = 'flex-start';
                    }
                    if (headerLayout === 'same-row') {
                        currentHouse.color_settings = currentHouse.color_settings || {};
                        currentHouse.color_settings.logo_position = 'left';
                        localStorage.setItem(houseKey + '_logo_position', 'left');
                    } else if (!colorSettings.logo_position) {
                        localStorage.setItem(houseKey + '_logo_position', logoPosition);
                    }
                }
            }
        }

        if (isPreviewMode) {
            const previewTitle = previewHouseId || house.store_info.name || '';
            document.title = `Xem trước ${previewTitle}`;
            let previewBadge = document.getElementById('st-preview-badge');
            if (!previewBadge) {
                previewBadge = document.createElement('div');
                previewBadge.id = 'st-preview-badge';
                previewBadge.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(255,234,175,0.95);color:#846404;z-index:100011;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 5px 18px rgba(0,0,0,0.12);pointer-events:none;';
                document.body.appendChild(previewBadge);
            }
            let createdAt = PREVIEW_META?.created_at || '';
            if (!createdAt && PREVIEW_META?.uuid) {
                var match = PREVIEW_META.uuid.match(/-(\d{6}-\d{6})$/);
                if (match) {
                    var ts = match[1]; // 'hhmmss-ddmmyyyy'
                    createdAt = ts.replace(/(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{4})/, '$1:$2:$3 $4/$5/$6');
                }
            }
            const previewDate = createdAt.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1');
            previewBadge.innerText = `Xem trước web` + (previewDate ? ` ngày ${previewDate}` : '');
        }

        // Ensure list popup you're appending once
        if (!document.getElementById('st-house-list-popup')) {
            const listPopup = document.createElement('div');
            listPopup.id = 'st-house-list-popup';
            listPopup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:200001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);';
            listPopup.innerHTML = `
                <div style="width:min(95%,650px);max-height:85%;background:#fff;border-radius:10px;overflow:auto;padding:16px;position:relative;">
                    <button id="st-house-list-close" style="position:absolute;top:12px;right:12px;border:none;background:#eee;border-radius:50%;width:28px;height:28px;cursor:pointer;font-weight:600;">×</button>
                    <h3 style="margin:0 0 12px;font-size:16px;color:#333;">Danh sách nhà</h3>
                    <div id="st-house-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"></div>
                </div>
            `;
            document.body.appendChild(listPopup);
            document.getElementById('st-house-list-close').onclick = () => { listPopup.style.display = 'none'; };
        }

        const visiblePages = Array.isArray(house.pages) ? house.pages.filter(page => !isMenuPageHidden(page)) : [];
        const shouldShowMenuBar = visiblePages.length > 0;
        if (shouldShowMenuBar) {
            const sameRowTransparent = (house?.menuSettings?.layout === 'same-row') && (house?.color_settings?.menu_bg_mode === 'transparent');
            if (sameRowTransparent) {
                menuBar.style.visibility = 'hidden';
                menuBar.style.background = 'transparent';
                menuBar.style.backgroundSize = '';
                menuBar.style.backgroundPosition = '';
                menuBar.style.backgroundRepeat = '';
                menuBar.style.borderBottom = 'none';
                menuBar.style.boxShadow = 'none';
                menuBar.style.removeProperty('--st-menu-text-color');
                menuBar.style.removeProperty('--st-menu-hover-color');
                menuBar.style.removeProperty('--st-menu-active-color');
            }
            let menuHtml = '';
            const activePageId = house.pages[currentPageIdx]?.id;
            visiblePages.forEach((p) => { menuHtml += `<a class="st-menu-item ${p.id===activePageId?'active':''}" data-id="${p.id}">${p.label}</a>`; });
            menuBar.innerHTML = menuHtml;
            updateHeaderEditButtonVisibility(liveUpdateMode);
            menuBar.querySelectorAll('.st-menu-item').forEach(btn => btn.onclick = () => showPage(btn.dataset.id));

            const menuAlign = house.menuSettings?.align || 'left';
            const mobileMode = house.menuSettings?.mobile_mode || 'scroll';
            const isMobileScreen = window.innerWidth <= 768;
            menuBar.classList.remove('align-left', 'align-center', 'align-right', 'mode-stack');
            menuBar.classList.add(`align-${menuAlign}`);
            menuBar.style.justifyContent = menuAlign === 'center' ? 'center' : menuAlign === 'right' ? 'flex-end' : 'flex-start';
            if (mobileMode === 'stack' && isMobileScreen) {
                menuBar.style.alignItems = 'stretch';
                menuBar.style.flexDirection = 'column';
                menuBar.style.height = 'auto';
                menuBar.classList.add('mode-stack');
            } else {
                menuBar.style.alignItems = 'center';
                menuBar.style.flexDirection = 'row';
                menuBar.style.height = '36px';
            }

            menuBar.style.paddingRight = '0';
            menuBar.style.display = 'flex';
            const barEl = document.getElementById('street-bar');
            const editToggleRow = document.getElementById('st-menu-edit-row');
            const houseId = house.id || house.house_id || 'default';
            const houseKey = 'house_' + houseId;
            const colorSettings = house.color_settings || {};
            const layout = house.menuSettings?.layout || 'logo-top';
            const menuTopLayout = layout === 'menu-top';
            const rawHeaderSticky = (typeof colorSettings.header_sticky !== 'undefined')
                ? (colorSettings.header_sticky ? '1' : '0')
                : (localStorage.getItem(houseKey + '_header_sticky') || '1');
            const isStickyNow = String(rawHeaderSticky) === '1' || String(rawHeaderSticky) === 'true';
            if (isStickyNow) {
                if (menuBar.parentNode !== document.body || menuBar.previousSibling !== barEl) {
                    document.body.insertBefore(menuBar, barEl);
                }
                if (editToggleRow && editToggleRow.parentNode !== document.body) {
                    document.body.insertBefore(editToggleRow, actionsBar);
                }
            } else if (barEl) {
                if (menuBar.parentNode !== document.body || menuBar.nextSibling !== (menuTopLayout ? barEl : barEl.nextSibling)) {
                    document.body.insertBefore(menuBar, menuTopLayout ? barEl : barEl.nextSibling);
                }
                if (editToggleRow && editToggleRow.parentNode !== document.body) {
                    document.body.insertBefore(editToggleRow, actionsBar);
                }
            }
            if (editToggleRow) {
                const editToggleBtn = document.getElementById('st-edit-toggle-btn');
                const editRowVisible = !!editToggleBtn && editToggleBtn.style.display !== 'none' && menuBar.style.display !== 'none';
                if (isStickyNow) {
                    const menuHeightNow = menuBar.style.display !== 'none' ? (menuBar.offsetHeight || 36) : 0;
                    editToggleRow.style.position = 'fixed';
                    editToggleRow.style.left = '0';
                    editToggleRow.style.width = '100%';
                    editToggleRow.style.zIndex = '99998';
                    editToggleRow.style.top = `${Math.round(menuTopLayout ? (hh + menuHeightNow) : ((barEl?.getBoundingClientRect().bottom || hh) + menuHeightNow))}px`;
                } else {
                    editToggleRow.style.position = 'static';
                    editToggleRow.style.top = '';
                    editToggleRow.style.left = '';
                    editToggleRow.style.width = '100%';
                    editToggleRow.style.zIndex = '';
                }
                editToggleRow.style.display = editRowVisible ? 'flex' : 'none';
            }
            renderMenuPanel(house);
            updateMenuLayout(house);
        } else {
            menuBar.classList.remove('align-left', 'align-center', 'align-right', 'mode-stack');
            menuBar.style.display = 'none';
            const editToggleRow = document.getElementById('st-menu-edit-row');
            if (editToggleRow) editToggleRow.style.display = 'none';
            // if header is sticky we need to keep body padded by header height, otherwise clear inline padding
            const barEl = document.getElementById('street-bar');
            const hh = barEl ? (barEl.offsetHeight || parseInt(barEl.style.height, 10) || 70) : 70;
            const isStickyNow = barEl && (barEl.style.position === 'fixed');
            const editBarElNM = document.getElementById('st-edit-mode-bar');
            const editBarHNM = (editBarElNM && editBarElNM.classList.contains('active')) ? (editBarElNM.offsetHeight || 52) : 0;
            if (isStickyNow) {
                if (barEl) barEl.style.top = `${editBarHNM}px`;
                document.body.style.paddingTop = (hh + editBarHNM) + 'px';
            } else {
                document.body.style.paddingTop = '0px';
            }
        }

        const buildHouseList = () => {
            const grid = document.getElementById('st-house-grid');
            if (!grid) return;
            grid.innerHTML = '';

            const poolSource = Array.isArray(registry) ? registry : (Array.isArray(currentRegistry) ? currentRegistry : []);
            const pool = poolSource
                .filter(h => h && typeof h.url === 'string' && h.url.trim())
                .map(h => ({ ...h, url: h.url.trim() }));

            // find current index based on URL
            const curUrl = window.location.href.toLowerCase().replace(/\/$/, "");
            const curIndex = pool.findIndex(h => curUrl.includes(h.url.toLowerCase().replace(/\/$/, "")));

            const start = curIndex === -1 ? 0 : Math.max(0, curIndex - 5);
            const end = curIndex === -1 ? Math.min(pool.length, 10) : Math.min(pool.length, curIndex + 6);

            const selected = pool.slice(start, end);

            selected.forEach(h => {
                const isActive = h.url.toLowerCase().replace(/\/$/, "") === curUrl;
                const item = document.createElement('div');
                item.style.cssText = 'padding:12px;border-radius:12px;cursor:pointer;background:' + (isActive ? '#f0f8ff' : '#fff') + ';box-shadow:0 8px 20px rgba(0,0,0,0.12);min-height:120px;display:flex;flex-direction:column;justify-content:center;gap:8px;border:1px solid #eceef0;';
                item.innerHTML = `<div style="font-size:13px;font-weight:600;color:#333;line-height:1.2;">${h.cat || 'Chưa rõ danh mục'}</div><div style="font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.url}</div>`;
                item.onclick = () => {
                    window.location.href = h.url;
                };
                grid.appendChild(item);
            });
        };

        const hamburgerToggle = document.getElementById('st-hamburger-toggle');
        if (hamburgerToggle) {
            hamburgerToggle.onclick = () => window.stToggleMenu();
        }

        const initialPageId = getPageIdFromUrl();
        const initialVisiblePages = house.pages.filter(p => !isMenuPageHidden(p));
        const initialPage = initialVisiblePages.find(p => p.id === initialPageId) || initialVisiblePages[0] || null;
        if (initialPage) {
            showPage(initialPage.id, { updateUrl: false });
            syncPageIdToUrl(initialPage.id, true);
        } else {
            const template = document.getElementById('house-template');
            if (template) template.innerHTML = '';
            renderMenuPanel(house);
        }
        renderActionsBar();
    };

    const moveHouse = (dir, registry = null) => {
        if (!currentHouse) return;
        const cur = window.location.href.toLowerCase().replace(/\/$/, "");
        const poolSource = Array.isArray(registry) ? registry : (Array.isArray(currentRegistry) ? currentRegistry : []);

        const pool = poolSource
            .filter(h => h && typeof h.url === 'string' && h.url.trim())
            .map(h => {
                let s = 0;
                if (h.cat === currentHouse.tags.category) s += 10000;
                if (h.prov === currentHouse.tags.province) s += 1;
                return { ...h, score: s, url: h.url.trim() };
            })
            .sort((a, b) => b.score - a.score);

        if (!pool.length) {
            console.warn('moveHouse: no houses in registry pool');
            return;
        }

        let i = pool.findIndex(h => {
            if (!h.url) return false;
            return cur.includes(h.url.toLowerCase().replace(/\/$/, ""));
        });
        if (i === -1) i = 0;

        let n = (dir === 'next') ? (i + 1) % pool.length : (i - 1 + pool.length) % pool.length;

        if (pool[n] && pool[n].url) {
            window.location.href = pool[n].url;
        } else {
            console.warn('moveHouse: target house url missing', pool[n]);
        }
    };

    const bar = document.createElement('div'); bar.id = 'street-bar';
    const menuBar = document.createElement('div'); menuBar.id = 'st-menu';
    const actionsBar = document.createElement('div'); actionsBar.id = 'st-actions';

    const updateMenuLayout = (house) => {
        if (!house || !menuBar) return;
        const layout = house.menuSettings?.layout || 'logo-top';
        const menuAlign = house.menuSettings?.align || 'left';
        const mobileMode = house.menuSettings?.mobile_mode || 'scroll';
        const isMobileScreen = window.innerWidth <= 768;
        const barEl = document.getElementById('street-bar');
        const houseId = house.id || house.house_id || 'default';
        const houseKey = 'house_' + houseId;
        const colorSettings = house.color_settings || {};
        const rawHeaderSticky = (typeof colorSettings.header_sticky !== 'undefined')
            ? (colorSettings.header_sticky ? '1' : '0')
            : (localStorage.getItem(houseKey + '_header_sticky') || '1');
        const isStickyNow = String(rawHeaderSticky) === '1' || String(rawHeaderSticky) === 'true';
        const hh = barEl ? (barEl.offsetHeight || parseInt(barEl.style.height, 10) || 70) : 70;
        const menuHeight = menuBar.style.display !== 'none' ? (menuBar.offsetHeight || 36) : 0;
        const sameRowLayout = layout === 'same-row';
        const menuTopLayout = layout === 'menu-top';
        const editBarEl = document.getElementById('st-edit-mode-bar');
        const editBarH = (editBarEl && editBarEl.classList.contains('active')) ? (editBarEl.offsetHeight || 52) : 0;

        if (sameRowLayout && (colorSettings.menu_bg_mode === 'transparent')) {
            menuBar.style.visibility = 'hidden';
            menuBar.style.background = 'transparent';
            menuBar.style.backgroundSize = '';
            menuBar.style.backgroundPosition = '';
            menuBar.style.backgroundRepeat = '';
            menuBar.style.borderBottom = 'none';
            menuBar.style.boxShadow = 'none';
        }

        menuBar.style.position = sameRowLayout ? 'static' : 'fixed';
        menuBar.style.top = sameRowLayout ? '' : (menuTopLayout ? `${editBarH}px` : `${hh + editBarH}px`);
        menuBar.style.left = sameRowLayout ? '' : '0';
        menuBar.style.width = sameRowLayout ? 'auto' : '100%';
        menuBar.style.zIndex = sameRowLayout ? '' : '99999';
        menuBar.style.height = sameRowLayout ? 'auto' : '36px';
        menuBar.style.flex = sameRowLayout ? '0 0 auto' : '';
        menuBar.style.width = sameRowLayout ? 'fit-content' : '100%';
        menuBar.style.maxWidth = sameRowLayout ? '100%' : '';
        menuBar.style.minWidth = sameRowLayout ? '0' : '';
        menuBar.style.overflowX = sameRowLayout ? 'auto' : 'auto';
        menuBar.style.justifyContent = sameRowLayout
            ? 'flex-end'
            : (menuAlign === 'center' ? 'center' : menuAlign === 'right' ? 'flex-end' : 'flex-start');
        applyMenuBgSetting(house, barEl, menuBar, menuTopLayout, sameRowLayout);
        menuBar.style.marginLeft = sameRowLayout ? 'auto' : '';
        menuBar.style.padding = sameRowLayout ? '0' : '';

        menuBar.classList.remove('align-left', 'align-center', 'align-right', 'mode-stack');
        menuBar.classList.add(`align-${sameRowLayout ? 'right' : menuAlign}`);

        if (mobileMode === 'stack' && isMobileScreen) {
            menuBar.style.alignItems = 'stretch';
            menuBar.style.flexDirection = 'column';
            menuBar.style.height = 'auto';
            menuBar.classList.add('mode-stack');
        } else {
            menuBar.style.alignItems = 'center';
            menuBar.style.flexDirection = 'row';
            if (!sameRowLayout) menuBar.style.height = '36px';
        }

        const hamburgerToggle = document.getElementById('st-hamburger-toggle');
        if (hamburgerToggle) {
            hamburgerToggle.style.display = (isMobileScreen && mobileMode === 'hamburger') ? 'inline-flex' : 'none';
        }

        if (sameRowLayout) {
            const btnGroup = barEl.querySelector('.st-btn-group');
            if (btnGroup && menuBar.parentNode !== barEl) {
                barEl.insertBefore(menuBar, btnGroup);
            }
            menuBar.style.display = (isMobileScreen && mobileMode === 'hamburger') ? 'none' : 'flex';
            menuBar.style.width = 'fit-content';
            menuBar.style.maxWidth = '100%';
            barEl.style.justifyContent = 'flex-start';
            barEl.style.gap = '12px';
            barEl.style.overflow = 'hidden';
            const barLeft = barEl.querySelector('.st-bar-left');
            const storeInfo = barEl.querySelector('.st-store-info');
            if (barLeft) {
                barLeft.style.flex = '0 0 auto';
                barLeft.style.minWidth = '0';
            }
            if (storeInfo) {
                storeInfo.style.position = 'relative';
                storeInfo.style.left = '';
                storeInfo.style.top = '';
                storeInfo.style.transform = '';
                storeInfo.style.width = '';
                storeInfo.style.zIndex = '';
                storeInfo.style.flex = '1';
                storeInfo.style.minWidth = '0';
                storeInfo.style.textAlign = 'left';
                storeInfo.style.alignItems = 'flex-start';
                storeInfo.style.justifyContent = 'flex-start';
            }
            if (btnGroup) btnGroup.style.flex = '0 0 auto';
        } else {
            barEl.style.justifyContent = 'space-between';
            barEl.style.gap = '';
            barEl.style.overflow = '';
            const barLeft = barEl.querySelector('.st-bar-left');
            const btnGroup = barEl.querySelector('.st-btn-group');
            if (barLeft) barLeft.style.flex = '1';
            if (btnGroup) btnGroup.style.flex = '0 0 auto';
            if (isStickyNow) {
                if (menuBar.parentNode !== document.body || menuBar.previousSibling !== barEl) {
                    document.body.insertBefore(menuBar, barEl);
                }
                barEl.style.position = 'fixed';
                barEl.style.left = '0';
                barEl.style.width = '100%';
                barEl.style.top = menuTopLayout ? `${menuHeight + editBarH}px` : `${editBarH}px`;
                barEl.style.zIndex = '200700';
            } else if (barEl) {
                barEl.style.position = 'static';
                barEl.style.left = '';
                barEl.style.width = '100%';
                barEl.style.top = '';
                barEl.style.zIndex = '';
                if (menuBar.parentNode !== document.body || menuBar.nextSibling !== (menuTopLayout ? barEl : barEl.nextSibling)) {
                    document.body.insertBefore(menuBar, menuTopLayout ? barEl : barEl.nextSibling);
                }
            }
        }

        if (sameRowLayout) {
            menuBar.style.display = (isMobileScreen && mobileMode === 'hamburger') ? 'none' : 'flex';
        } else if (isStickyNow) {
            menuBar.style.display = (isMobileScreen && mobileMode === 'hamburger') ? 'none' : 'flex';
            menuBar.style.top = menuTopLayout ? `${editBarH}px` : `${hh + editBarH}px`;
        } else {
            menuBar.style.position = 'static';
            menuBar.style.top = '';
            menuBar.style.left = '';
            menuBar.style.width = '100%';
            menuBar.style.zIndex = '';
            menuBar.style.display = (isMobileScreen && mobileMode === 'hamburger') ? 'none' : 'flex';
        }

        const editToggleRow = document.getElementById('st-menu-edit-row');
        const editToggleBtn = document.getElementById('st-edit-toggle-btn');
        const editRowVisible = !!editToggleBtn && editToggleBtn.style.display !== 'none' && menuBar.style.display !== 'none';
        if (editToggleRow) {
            if (editToggleRow.parentNode !== document.body || editToggleRow.previousSibling !== barEl) {
                document.body.insertBefore(editToggleRow, barEl.nextSibling);
            }
            if (isStickyNow) {
                let editToggleRowTop;
                if (menuTopLayout) {
                    // When menu is on top, position toggle below the header bar (barEl)
                    const barElTopPos = parseInt(barEl.style.top || '0');
                    editToggleRowTop = barElTopPos + hh;
                } else {
                    // For logo-top, keep the edit row below the menu so it does not
                    // sit between the logo/header and the menu itself.
                    const menuHeightNow = menuBar.style.display !== 'none' ? (menuBar.offsetHeight || 36) : 0;
                    editToggleRowTop = (barEl?.getBoundingClientRect().bottom || hh) + menuHeightNow;
                }
                editToggleRow.style.position = 'fixed';
                editToggleRow.style.top = `${Math.round(editToggleRowTop)}px`;
                editToggleRow.style.left = '0';
                editToggleRow.style.width = '100%';
                editToggleRow.style.zIndex = '99998';
            } else {
                editToggleRow.style.position = 'static';
                editToggleRow.style.top = '';
                editToggleRow.style.left = '';
                editToggleRow.style.width = '100%';
                editToggleRow.style.zIndex = '';
            }
            editToggleRow.style.display = editRowVisible ? 'flex' : 'none';
        }

        // Don't add edit-row padding for the common "logo-top" menu layout
        // because the edit row would otherwise push the menu away from the logo.
        const editRowPadding = (editToggleRow && editToggleRow.style.display !== 'none' && !menuTopLayout)
            ? (editToggleRow.offsetHeight || 0)
            : 0;
        const menuPadding = (!sameRowLayout && menuBar.style.display !== 'none') ? (menuBar.offsetHeight || menuHeight) : 0;
        if (isStickyNow) {
            document.body.style.paddingTop = `${hh + menuPadding + editRowPadding + editBarH}px`;
        } else {
            document.body.style.paddingTop = '0px';
        }

        applyMenuColorTheme(house);
    };

    let resizeLayoutRefreshTimer = null;
    window.addEventListener('resize', () => {
        if (!currentHouse) return;
        window.clearTimeout(resizeLayoutRefreshTimer);
        resizeLayoutRefreshTimer = window.setTimeout(() => {
            const currentPageId = currentHouse.pages?.[currentPageIdx]?.id || currentHouse.pages?.[0]?.id || '';
            const savedScrollY = window.scrollY || window.pageYOffset || 0;

            renderHouse(currentInfra, currentHouse, currentRegistry);

            if (currentPageId) {
                showPage(currentPageId, { updateUrl: false });
            }

            window.requestAnimationFrame(() => {
                window.scrollTo(0, savedScrollY);
            });
        }, 120);
    });

    window.addEventListener('popstate', () => {
        if (!currentHouse?.pages?.length) return;
        const requestedPageId = getPageIdFromUrl();
        const targetPage = currentHouse.pages.find(p => p.id === requestedPageId) || currentHouse.pages[0];
        if (targetPage) {
            showPage(targetPage.id, { updateUrl: false });
        }
    });
    
    // Create house template if it doesn't exist
    let template = document.getElementById('house-template');
    if (!template) {
        template = document.createElement('div');
        template.id = 'house-template';
        document.body.appendChild(template);
    }
    let footerHost = document.getElementById('st-footer-host');
    if (!footerHost) {
        footerHost = document.createElement('div');
        footerHost.id = 'st-footer-host';
        footerHost.style.width = '100%';
        footerHost.style.maxWidth = 'none';
        template.insertAdjacentElement('afterend', footerHost);
    }
    
    document.body.prepend(menuBar);
    document.body.prepend(bar);
    document.body.appendChild(actionsBar);



    const menuPanelOverlay = document.createElement('div');
    menuPanelOverlay.id = 'st-menu-panel-overlay';
    menuPanelOverlay.onclick = closeMenuPanel;
    document.body.appendChild(menuPanelOverlay);

    const menuPanel = document.createElement('div');
    menuPanel.id = 'st-menu-panel';
    menuPanel.innerHTML = `
        <div class="panel-header">
            <div class="panel-title">Menu</div>
            <button id="st-menu-panel-close" class="panel-close" type="button">×</button>
        </div>
        <div id="st-menu-panel-list"></div>
    `;
    document.body.appendChild(menuPanel);
    const menuPanelClose = menuPanel.querySelector('#st-menu-panel-close');
    if (menuPanelClose) menuPanelClose.onclick = closeMenuPanel;


    // expose globally so inline links (if any) can call.
    window.streetLive = {
        getCurrentHouse: () => currentHouse,
        getCurrentPageIdx: () => typeof currentPageIdx === 'number' ? currentPageIdx : 0,
        getPreviewHouseId: () => previewHouseId,
        getAvailableBuilders: () => availableBuilders,
        getCurrentUrl: () => window.location.href,
        showPage: (pageId) => {
            if (typeof showPage === 'function') showPage(pageId);
        },
        refreshMenuAfterEdit: () => {
            if (!currentHouse) return;
            renderMenuPanel(currentHouse);
            renderHouse(currentInfra, currentHouse, currentRegistry);
            if (typeof window.setupFloatingActionsForSections === 'function') {
                setTimeout(() => window.setupFloatingActionsForSections(), 0);
            }
        },
        updateMenuLayoutNow: (house) => {
            if (!house) house = currentHouse;
            if (!house) return;
            // Re-render house to update menu layout immediately
            renderMenuPanel(house);
            renderHouse(currentInfra, house, currentRegistry);
        },
        buildFooterMarkup: (house) => buildFooterMarkup(house || currentHouse || {}),
        applyMenuColorThemeNow: (house) => {
            applyMenuColorTheme(house || currentHouse);
        },
        applyMenuBgSettingNow: (house) => {
            const h = house || currentHouse;
            if (!h || !menuBar) return;
            const barEl = document.getElementById('street-bar');
            const layout = h?.menuSettings?.layout || 'logo-top';
            applyMenuBgSetting(h, barEl, menuBar, layout === 'menu-top', layout === 'same-row');
        },
        saveHouseJsonToDrive: () => {
            if (typeof window.saveHouseJsonToDrive === 'function') return window.saveHouseJsonToDrive();
            return Promise.reject(new Error('saveHouseJsonToDrive not available'));
        }
    };

    Promise.all([
        fetch(INFRA_URL).then(res => res.json()),
        contentPromise,
        fetch(REGISTRY_URL).then(res => res.json())
    ]).then(([infra, house, registry]) => {
        console.log('renderHouse: infra', infra, 'house', house, 'registry', registry);
        renderHouse(infra, house, registry);
    }).catch(err => {
        console.error('Preview load error:', err);
        const template = document.getElementById('house-template');
        if (template) {
            template.innerHTML = '<div style="padding:40px;text-align:center;color:#c0392b;">Không thể tải preview: ' + (err.message || err) + '</div>';
        }
    });
})();