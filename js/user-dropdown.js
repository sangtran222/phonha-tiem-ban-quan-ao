(function () {
    'use strict';

    let _udBodyScrollLocked = false;
    let _udSavedBodyPaddingRight = '';

    const getScrollbarWidth = () => window.innerWidth - document.documentElement.clientWidth;

    const lockBodyScroll = () => {
        if (_udBodyScrollLocked) return;
        const scrollbarWidth = getScrollbarWidth();
        if (scrollbarWidth > 0) {
            _udSavedBodyPaddingRight = document.body.style.paddingRight || '';
            const computedPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
            document.body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
        }
        document.body.style.overflow = 'hidden';
        _udBodyScrollLocked = true;
    };

    const unlockBodyScroll = () => {
        if (!_udBodyScrollLocked) return;
        document.body.style.overflow = '';
        document.body.style.paddingRight = _udSavedBodyPaddingRight;
        _udBodyScrollLocked = false;
    };

    const loadProductModule = () => {
        if (window._streetProductModuleLoaded) return Promise.resolve();
        const STREET_ROOT = (window.STREET_ROOT || '').replace(/\/$/, '');
        const _loadScript = (src) => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Không tải được: ' + src));
            document.head.appendChild(script);
        });
        const base = window.__UserPopupManager
            ? Promise.resolve()
            : _loadScript(`${STREET_ROOT}/builder/user-popup.js`);
        return base
            .then(() => _loadScript(`${STREET_ROOT}/builder/product.js`))
            .then(() => { window._streetProductModuleLoaded = true; });
    };

    // Load builder modules in dependency order
    const loadBuilderModules = () => {
        if (window._streetBuilderModulesLoaded) return Promise.resolve();
        if (window._streetBuilderModulesLoading) return window._streetBuilderModulesLoading;

        const STREET_ROOT = (window.STREET_ROOT || '').replace(/\/$/, '');
        const loadScript = (src) => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Không tải được: ' + src));
            document.head.appendChild(script);
        });

        window._streetBuilderModulesLoading = loadScript(`${STREET_ROOT}/builder/store.js`)
            .then(() => loadScript(`${STREET_ROOT}/builder/style.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/user-popup.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/menu.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/editor.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-header.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-body.js`))
            .then(() => loadScript(`${STREET_ROOT}/builder/ui-footer.js`))
            .then(() => { window._streetBuilderModulesLoaded = true; });

        return window._streetBuilderModulesLoading;
    };

    // Activate page edit mode by clicking the edit toggle if not already active
    const _activateEditMode = () => {
        const btn = document.getElementById('st-edit-toggle-btn');
        if (btn && !btn.classList.contains('active')) {
            btn.click();
        }
    };

    const ensureHostLogin = async () => {
        const uiApi = window.__LEUI || {};
        if (typeof window.checkServerSessionLive !== 'function' || typeof window.openHostLoginModal !== 'function') {
            await loadBuilderModules();
        }
        const checkSession = typeof window.checkServerSessionLive === 'function'
            ? window.checkServerSessionLive
            : (typeof uiApi.checkServerSessionLive === 'function' ? uiApi.checkServerSessionLive : null);
        const openLogin = typeof window.openHostLoginModal === 'function'
            ? window.openHostLoginModal
            : (typeof uiApi.openHostLoginModal === 'function' ? uiApi.openHostLoginModal : null);

        if (!checkSession || !openLogin) { console.warn('Host login modal is not available'); return false; }
        const isLoggedIn = await checkSession();
        if (!isLoggedIn) { openLogin(); return false; }
        return true;
    };

    const closeUserPopupMenu = () => {
        const popup = document.getElementById('st-user-popup-menu');
        if (popup) popup.style.display = 'none';
        unlockBodyScroll();
    };

    // (Removed nested "+ Thêm" submenu)

    const _openAddSubmenu = () => {
        _ensureAddSubmenu();
        const sub      = document.getElementById('st-user-add-sub');
        const mainPop  = document.getElementById('st-user-popup-menu');
        const addBtn   = document.getElementById('st-user-menu-add');
        if (!sub || !mainPop || !addBtn) return;

        const mainRect = mainPop.getBoundingClientRect();
        const btnRect  = addBtn.getBoundingClientRect();

        // Position to the LEFT of the main popup, top-aligned with the button
        const subW  = 180;
        const gap   = 8;
        let topPos  = btnRect.top;
        let leftPos = mainRect.left - subW - gap;

        // Clamp: if going off the left edge, place to the right instead
        if (leftPos < 8) leftPos = mainRect.right + gap;
        // Clamp vertical to viewport
        const subH = 200;
        if (topPos + subH > window.innerHeight - 10) topPos = window.innerHeight - subH - 10;
        if (topPos < 10) topPos = 10;

        sub.style.top  = topPos + 'px';
        sub.style.left = leftPos + 'px';
        sub.style.right = 'auto';
        sub.style.display = 'flex';
        _addSubOpen = true;
    };

    // ── Main popup ─────────────────────────────────────────────────────────────
    const ensureUserPopupMenu = () => {
        if (document.getElementById('st-user-popup-menu')) return;
        const popup = document.createElement('div');
        popup.id = 'st-user-popup-menu';
        popup.style.cssText = 'position:fixed;top:60px;right:18px;z-index:200750;min-width:180px;padding:10px;background:#fff;border:1px solid rgba(0,0,0,0.1);border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.12);display:none;flex-direction:column;gap:8px;';
        popup.innerHTML = `
            <button id="st-user-menu-products"    type="button" style="width:100%;border:1px solid #ddd6fe;background:#f5f3ff;color:#5b21b6;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Sản phẩm</button>
            <button id="st-user-menu-save-host"   type="button" style="width:100%;border:1px solid #d1d5db;background:#f8fafc;color:#0f172a;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Lưu host</button>
            <button id="st-user-menu-download"    type="button" style="width:100%;border:1px solid #d1d5db;background:#f8fafc;color:#0f172a;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Tải về</button>
            <button id="st-user-menu-theme"       type="button" style="width:100%;border:1px solid #94a3b8;background:#f8fafc;color:#334155;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Giao diện chung</button>
            <button id="st-user-menu-manage-menu" type="button" style="width:100%;border:1px solid #94a3b8;background:#f8fafc;color:#334155;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Quản lý menu</button>
            <button id="st-user-menu-logout"      type="button" style="width:100%;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Thoát</button>
        `;
        document.body.appendChild(popup);

        popup.addEventListener('click', (e) => e.stopPropagation());

        // (nested "+ Thêm" removed)

        // Sản phẩm (product manager)
        popup.querySelector('#st-user-menu-products').addEventListener('click', async () => {
            closeUserPopupMenu();
            if (typeof window.openProductPopup !== 'function') {
                try { await loadProductModule(); } catch (err) { console.error('Không thể tải product module:', err); return; }
            }
            if (typeof window.openProductPopup === 'function') window.openProductPopup();
        });

        // Lưu host
        popup.querySelector('#st-user-menu-save-host').addEventListener('click', async () => {
            closeUserPopupMenu();
            const isLoggedIn = await ensureHostLogin();
            if (!isLoggedIn) return;
            if (typeof window.openLiveSaveMenu === 'function') { window.openLiveSaveMenu(); return; }
            if (typeof window.saveCurrentHouseToHost === 'function') { window.saveCurrentHouseToHost(); return; }
            try {
                await loadBuilderModules();
                const retryLoggedIn = await ensureHostLogin();
                if (!retryLoggedIn) return;
                if (typeof window.openLiveSaveMenu === 'function') window.openLiveSaveMenu();
                else if (typeof window.saveCurrentHouseToHost === 'function') window.saveCurrentHouseToHost();
                else console.warn('Không tìm thấy hàm lưu host sau khi tải builder modules');
            } catch (e) { console.error('Không thể tải builder modules để lưu host:', e); }
        });

        // Tải về
        popup.querySelector('#st-user-menu-download').addEventListener('click', async () => {
            closeUserPopupMenu();
            const currentHouse = window.streetLive?.getCurrentHouse?.() || {};
            const houseId = currentHouse?.house_id || currentHouse?.id || '';
            if (!houseId) { alert('Không xác định được house_id để tải file.'); return; }
            const root = (window.STREET_ROOT || '').replace(/\/$/, '');
            try {
                const response = await fetch(`${root}/host/api_download_zip.php?house_id=${encodeURIComponent(houseId)}`, { method: 'GET', credentials: 'include' });
                const contentType = response.headers.get('Content-Type') || '';
                if (!response.ok) {
                    if (contentType.includes('application/json')) { const json = await response.json(); throw new Error(json.error || 'Lỗi khi tạo file zip'); }
                    throw new Error(response.statusText || 'Lỗi khi tạo file zip');
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `house-${houseId}.zip`;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (err) { console.error('Tải về zip thất bại:', err); alert('Không thể tải về file zip: ' + (err.message || 'Lỗi')); }
        });

        // Giao diện chung
        popup.querySelector('#st-user-menu-theme').addEventListener('click', async () => {
            closeUserPopupMenu();
            if (typeof window.openUserThemePopup !== 'function') {
                try { await loadBuilderModules(); } catch (err) { console.error('Lỗi tải modules:', err); return; }
            }
            if (typeof window.openUserThemePopup === 'function') await window.openUserThemePopup('header', 'category');
        });

        // Quản lý menu
        popup.querySelector('#st-user-menu-manage-menu').addEventListener('click', async () => {
            closeUserPopupMenu();
            if (typeof window.openMenuManagementPopup !== 'function') {
                try { await loadBuilderModules(); } catch (err) { console.error('Lỗi tải modules:', err); return; }
            }
            if (typeof window.openMenuManagementPopup === 'function') await window.openMenuManagementPopup();
        });

        // Thoát
        popup.querySelector('#st-user-menu-logout').addEventListener('click', async () => {
            closeUserPopupMenu();
            const root = (window.STREET_ROOT || '').replace(/\/$/, '');
            try {
                await fetch(`${root}/host/logout.php`, { method: 'GET', credentials: 'include', redirect: 'follow' });
            } catch (err) { console.error('Logout AJAX failed:', err); }
            window.dispatchEvent(new CustomEvent('st-host-auth-changed', { detail: { loggedIn: false } }));
        });

        document.addEventListener('click', () => closeUserPopupMenu());
    };

    const toggleUserPopupMenu = () => {
        ensureUserPopupMenu();
        const popup = document.getElementById('st-user-popup-menu');
        if (!popup) return;
        if (popup.style.display === 'flex' || popup.style.display === 'block') {
            closeUserPopupMenu();
            return;
        }
        popup.style.display = 'flex';
        lockBodyScroll();
    };

    window.toggleUserPopupMenu = toggleUserPopupMenu;
    window.closeUserPopupMenu = closeUserPopupMenu;
    window.loadBuilderModules = loadBuilderModules;
})();
