// public/js/script.js
// Current Orders page

document.addEventListener('DOMContentLoaded', () => {
  const ordersListDiv = document.getElementById('orders-list');
  const searchInput = document.getElementById('orderSearch');

  // This file is included on multiple pages, so only run when the Current Orders list exists.
  if (!ordersListDiv) return;

  const CACHE_KEY = 'ordersDataV3';
  const CACHE_TTL_MS = 30 * 1000;

  // Flat list of order rows (each Notion page = one component line)
  let allItems = [];

  // Time-grouped orders (each group = one checkout / submission batch)
  let allGroups = [];
  let filteredGroups = [];

  // Map of rendered groups by their representative groupId
  let groupsById = new Map();

  // Modal (Order details)
  const modalOverlay = document.getElementById('coOrderModal');
  const modalCloseBtn = document.getElementById('coModalClose');
  const modalEls = {
    statusTitle: document.getElementById('coModalStatusTitle'),
    statusSub: document.getElementById('coModalStatusSub'),
    reason: document.getElementById('coModalReason'),
    date: document.getElementById('coModalDate'),
    components: document.getElementById('coModalComponents'),
    totalQty: document.getElementById('coModalTotalQty'),
    totalPrice: document.getElementById('coModalTotalPrice'),
    items: document.getElementById('coModalItems'),
  };

  let lastFocusEl = null;

  const norm = (s) => String(s || '').toLowerCase().trim();
  const toDate = (d) => new Date(d || 0);

  const escapeHTML = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  const moneyFmt = (() => {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
    } catch {
      return null;
    }
  })();

  function fmtMoney(value) {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    if (moneyFmt) return moneyFmt.format(safe);
    return `£${safe.toFixed(2)}`;
  }

  function fmtCreated(createdTime) {
    const d = toDate(createdTime);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Date-only (to show under the Reason on the card)
  function fmtDateOnly(createdTime) {
    const d = toDate(createdTime);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function sortByNewest(list) {
    return (list || []).slice().sort((a, b) => toDate(b.createdTime) - toDate(a.createdTime));
  }

  // ===== Grouping logic =====
  // Notion creates one page per component. When a user checks out,
  // multiple pages are created around the same time. We group these
  // together as one "order".
  const GROUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes window

  function summarizeReasons(items) {
    const counts = new Map();
    for (const it of items || []) {
      const r = String(it.reason || '').trim();
      if (!r) continue;
      counts.set(r, (counts.get(r) || 0) + 1);
    }

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const unique = entries.map(([k]) => k);

    if (unique.length === 0) return { title: 'No Reason', uniqueReasons: [] };
    if (unique.length === 1) return { title: unique[0], uniqueReasons: unique };

    const main = unique[0];
    return { title: `${main} +${unique.length - 1}`, uniqueReasons: unique };
  }

  function buildGroups(items) {
    const sorted = sortByNewest(items);
    const groups = [];

    let current = null;
    let currentAnchorMs = null; // newest time in current group

    for (const o of sorted) {
      const t = toDate(o.createdTime).getTime();

      if (!current) {
        current = {
          groupId: o.id, // representative id (newest item in group)
          latestCreated: o.createdTime,
          earliestCreated: o.createdTime,
          products: [],
          reason: '—',
          reasons: [],
        };
        currentAnchorMs = t;
      }

      const withinWindow = Math.abs(currentAnchorMs - t) <= GROUP_WINDOW_MS;

      // If the next item is far away in time, start a new group.
      if (!withinWindow) {
        // Finalize current group meta
        const summary = summarizeReasons(current.products);
        current.reason = summary.title;
        current.reasons = summary.uniqueReasons;
        groups.push(current);

        current = {
          groupId: o.id,
          latestCreated: o.createdTime,
          earliestCreated: o.createdTime,
          products: [],
          reason: '—',
          reasons: [],
        };
        currentAnchorMs = t;
      }

      current.products.push(o);

      if (!current.latestCreated || toDate(o.createdTime) > toDate(current.latestCreated)) {
        current.latestCreated = o.createdTime;
        current.groupId = o.id;
        currentAnchorMs = toDate(current.latestCreated).getTime();
      }
      if (!current.earliestCreated || toDate(o.createdTime) < toDate(current.earliestCreated)) {
        current.earliestCreated = o.createdTime;
      }
    }

    if (current) {
      const summary = summarizeReasons(current.products);
      current.reason = summary.title;
      current.reasons = summary.uniqueReasons;
      groups.push(current);
    }

    return groups.sort((a, b) => toDate(b.latestCreated) - toDate(a.latestCreated));
  }

  // ===== Order status flow (as requested) =====
  const STATUS_FLOW = [
    { label: 'Order Placed', sub: 'Your order has been placed.' },
    { label: 'Under Supervision', sub: 'Your order is under supervision.' },
    { label: 'In progress', sub: 'We are preparing your order.' },
    { label: 'Shipped', sub: 'Your cargo is on delivery.' },
    { label: 'Arrived', sub: 'Your order has arrived.' },
  ];

  function statusToIndex(status) {
    const s = norm(status).replace(/[_-]+/g, ' ');

    // Most advanced statuses first
    if (/(arrived|delivered|received)/.test(s)) return 5;
    if (/(shipped|on the way|delivering|prepared)/.test(s)) return 4;
    if (/(in progress|inprogress|progress)/.test(s)) return 3;
    if (/(under supervision|supervision|review)/.test(s)) return 2;
    if (/(order placed|placed|pending|order received)/.test(s)) return 1;
    return 1;
  }

  function computeStage(items) {
    const idx = Math.max(
      1,
      ...(items || []).map((x) => statusToIndex(x.status)),
    );
    const safe = Math.min(5, Math.max(1, idx));
    const meta = STATUS_FLOW[safe - 1] || STATUS_FLOW[0];
    return { idx: safe, label: meta.label, sub: meta.sub };
  }

  function setProgress(idx) {
    const safe = Math.min(5, Math.max(1, Number(idx) || 1));
    for (let i = 1; i <= 5; i++) {
      const stepEl = document.getElementById(`coStep${i}`);
      if (!stepEl) continue;
      stepEl.classList.toggle('is-active', i <= safe);
      stepEl.classList.toggle('is-current', i === safe);
    }
    for (let i = 1; i <= 4; i++) {
      const connEl = document.getElementById(`coConn${i}`);
      if (!connEl) continue;
      connEl.classList.toggle('is-active', i < safe);
    }
  }

  function openOrderModal(group) {
    if (!modalOverlay || !group) return;

    const items = group.products || [];
    const stage = computeStage(items);

    // Populate header
    if (modalEls.statusTitle) modalEls.statusTitle.textContent = stage.label;
    if (modalEls.statusSub) modalEls.statusSub.textContent = stage.sub;

    // Meta
    const totalQty = items.reduce((sum, x) => sum + (Number(x.quantity) || 0), 0);
    const estimateTotal = items.reduce(
      (sum, x) => sum + (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0),
      0,
    );

    if (modalEls.reason) modalEls.reason.textContent = group.reason || '—';
    if (modalEls.date) modalEls.date.textContent = fmtCreated(group.latestCreated) || '—';
    if (modalEls.components) modalEls.components.textContent = String(items.length);
    if (modalEls.totalQty) modalEls.totalQty.textContent = String(totalQty);
    if (modalEls.totalPrice) modalEls.totalPrice.textContent = fmtMoney(estimateTotal);

    // Items list
    if (modalEls.items) {
      modalEls.items.innerHTML = '';
      if (!items.length) {
        modalEls.items.innerHTML = '<div class="muted">No items.</div>';
      } else {
        const frag = document.createDocumentFragment();
        for (const it of items) {
          const qty = Number(it.quantity) || 0;
          const unit = Number(it.unitPrice) || 0;
          const lineTotal = qty * unit;

          const row = document.createElement('div');
          row.className = 'co-item';
          const itemReason = String(it.reason || '').trim();
          row.innerHTML = `
            <div class="co-item-left">
              <div class="co-item-name">${escapeHTML(it.productName || 'Unknown Product')}</div>
              <div class="co-item-sub">Reason: ${escapeHTML(itemReason || '—')} · Qty: ${escapeHTML(String(qty))} · Unit: ${escapeHTML(fmtMoney(unit))}</div>
            </div>
            <div class="co-item-right">
              <div class="co-item-total">${escapeHTML(fmtMoney(lineTotal))}</div>
              <div class="co-item-status">${escapeHTML(it.status || '—')}</div>
            </div>
          `;
          frag.appendChild(row);
        }
        modalEls.items.appendChild(frag);
      }
    }

    // Progress
    setProgress(stage.idx);

    // Show
    lastFocusEl = document.activeElement;
    modalOverlay.classList.add('is-open');
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('co-modal-open');

    // Ensure feather icons are rendered (in case the modal was injected later)
    if (window.feather) window.feather.replace();

    if (modalCloseBtn) modalCloseBtn.focus();
  }

  function closeOrderModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('is-open');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('co-modal-open');
    if (lastFocusEl && typeof lastFocusEl.focus === 'function') {
      lastFocusEl.focus();
    }
  }

  // (optional) You can still navigate to the tracking page using groupId if needed.
  // function goToTracking(groupId) {
  //   if (!groupId) return;
  //   const url = `/orders/tracking?groupId=${encodeURIComponent(groupId)}`;
  //   window.location.href = url;
  // }

  function renderCard(group) {
    const items = group.products || [];
    const first = items[0] || {};

    const itemsCount = items.length;
    // "Components price" = total cost of all items (qty * unitPrice)
    const estimateTotal = items.reduce(
      (sum, x) => sum + (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0),
      0,
    );

    // "NUMBERX" on the card should represent the number of components/items, not total quantity
    const componentsCount = itemsCount;

    const created = fmtDateOnly(group.latestCreated);
    const stage = computeStage(items);

    const title = escapeHTML(group.reason);

    // Under the title we show the date (per requested mapping)
    const sub = created ? escapeHTML(created) : '—';

    // Card price shows components total price (per requested mapping)
    const componentsPrice = fmtMoney(estimateTotal);

    const thumbHTML = first.productImage
      ? `<img src="${escapeHTML(first.productImage)}" alt="${escapeHTML(first.productName || group.reason)}" loading="lazy" />`
      : `<div class="co-thumb__ph">${escapeHTML(String(group.reason || '?').trim().slice(0, 2).toUpperCase())}</div>`;

    const card = document.createElement('article');
    card.className = 'co-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.groupId = group.groupId;

    card.innerHTML = `
      <div class="co-top">
        <div class="co-thumb">${thumbHTML}</div>

        <div class="co-main">
          <div class="co-title">${title}</div>
          <div class="co-sub">${sub}</div>
          <div class="co-price">${componentsPrice}</div>
        </div>

        <div class="co-qty">x${Number.isFinite(componentsCount) ? componentsCount : 0}</div>
      </div>

      <div class="co-divider"></div>

      <div class="co-bottom">
        <div class="co-est">
          <div class="co-est-label">Estimate Total</div>
          <div class="co-est-value">${componentsPrice}</div>
        </div>

        <div class="co-actions">
          <span class="co-status-btn">${escapeHTML(stage.label)}</span>
          <span class="co-right-ico" aria-hidden="true"><i data-feather="percent"></i></span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openOrderModal(group));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openOrderModal(group);
      }
    });

    return card;
  }

  function displayGroups(groups) {
    ordersListDiv.innerHTML = '';

    groupsById = new Map((groups || []).map((g) => [g.groupId, g]));
    if (!groups || groups.length === 0) {
      ordersListDiv.innerHTML = '<p>No orders found.</p>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const g of groups) frag.appendChild(renderCard(g));
    ordersListDiv.appendChild(frag);

    if (window.feather) window.feather.replace();
  }

  async function fetchAndDisplayOrders() {
    ordersListDiv.innerHTML = '<p><i class="loading-icon" data-feather="loader"></i> Loading orders...</p>';
    if (window.feather) window.feather.replace();

    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.data) && (Date.now() - (parsed.ts || 0) < CACHE_TTL_MS)) {
          allItems = sortByNewest(parsed.data);
          allGroups = buildGroups(allItems);
          filteredGroups = allGroups.slice();
          displayGroups(filteredGroups);
          return;
        }
        sessionStorage.removeItem(CACHE_KEY);
      }
    } catch {
      // ignore cache parse errors
    }

    try {
      const response = await fetch('/api/orders', { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch orders');
      }

      const data = await response.json();
      allItems = sortByNewest(Array.isArray(data) ? data : []);
      allGroups = buildGroups(allItems);
      filteredGroups = allGroups.slice();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: allItems }));
      displayGroups(filteredGroups);
    } catch (error) {
      console.error('Error fetching orders:', error);
      ordersListDiv.innerHTML = `<p style="color: red;">Error: ${escapeHTML(error.message)}</p>`;
    }
  }

  function setupSearch() {
    if (!searchInput) return;

    function groupMatchesQuery(g, q) {
      if (!q) return true;
      if (norm(g.reason).includes(q)) return true;
      const items = g.products || [];
      return items.some((it) => norm(it.reason).includes(q) || norm(it.productName).includes(q));
    }

    function runFilter() {
      const q = norm(searchInput.value);
      const base = allGroups;
      filteredGroups = q
        ? base.filter((g) => groupMatchesQuery(g, q))
        : base.slice();
      displayGroups(filteredGroups);
    }

    searchInput.addEventListener('input', runFilter);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        runFilter();
      }
    });
  }

  fetchAndDisplayOrders();
  setupSearch();

  // Modal wiring
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeOrderModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeOrderModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay?.classList.contains('is-open')) {
      e.preventDefault();
      closeOrderModal();
    }
  });
});
