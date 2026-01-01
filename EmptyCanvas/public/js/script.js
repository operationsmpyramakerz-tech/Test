// public/js/script.js
document.addEventListener('DOMContentLoaded', function () {
  const ordersListDiv   = document.getElementById('orders-list');
  const orderModal      = document.getElementById('orderModal');
  const orderModalBody  = document.getElementById('orderModalBody');
  const orderModalClose = document.getElementById('orderModalClose');
  const searchInput     = document.getElementById('orderSearch');

  const CACHE_KEY = 'ordersDataV2';
  const CACHE_TTL_MS = 30 * 1000;

  let allOrders = [];
  let filtered  = [];

  const norm = (s) => String(s || '').toLowerCase().trim();
  const toDate = (d) => new Date(d || 0);
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function sortByNewest(list) {
    return (list || []).slice().sort((a, b) => toDate(b.createdTime) - toDate(a.createdTime));
  }

  function displayOrders(orders) {
    if (!ordersListDiv) return;
    ordersListDiv.innerHTML = '';
    ordersListDiv.classList.add('co-grid');

    if (!orders || orders.length === 0) {
      ordersListDiv.classList.remove('co-grid');
      ordersListDiv.innerHTML = '<p>No orders found.</p>';
      return;
    }

    // Group orders by Reason (same behavior as before)
    const map = new Map();
    for (const o of orders) {
      const key = o.reason || 'No Reason';
      let g = map.get(key);
      if (!g) {
        g = { reason: key, latestCreated: o.createdTime, groupId: o.id, products: [] };
        map.set(key, g);
      }
      g.products.push(o);

      // Keep the newest item as the "representative" group id for tracking
      if (!g.latestCreated || toDate(o.createdTime) > toDate(g.latestCreated)) {
        g.latestCreated = o.createdTime;
        g.groupId = o.id;
      }
    }

    const groups = Array.from(map.values()).sort(
      (a, b) => toDate(b.latestCreated) - toDate(a.latestCreated)
    );

    const formatMoney = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '£0.00';
      try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
      } catch {
        return `£${n.toFixed(2)}`;
      }
    };

    const isReceived = (status) => norm(status).includes('received') && !norm(status).includes('not received');

    function openTrackingPage(group) {
      if (!group?.groupId) return;
      window.location.href = `/orders/tracking?groupId=${encodeURIComponent(group.groupId)}`;
    }

    const frag = document.createDocumentFragment();

    groups.forEach(group => {
      const itemsCount = group.products.length;
      const totalQty = group.products.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
      const estimateTotal = group.products.reduce((sum, p) => {
        const price = Number(p.unitPrice);
        const qty = Number(p.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
        return sum + price * qty;
      }, 0);

      const allReceived = itemsCount > 0 && group.products.every(p => isReceived(p.status));
      const statusText = allReceived ? 'Order Received' : 'On the way';

      const preview =
        group.products.find(p => p.productImage) ||
        group.products[0] ||
        {};

      const createdDate = new Date(group.latestCreated).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });

      // In the reference UI the top price is a "unit price" and the bottom value is
      // the estimated total. We try to display the first item's unit price when available.
      const unitPrice = (() => {
        const n = Number(preview.unitPrice);
        if (Number.isFinite(n) && n >= 0) return n;
        const qty = totalQty || 0;
        if (Number.isFinite(estimateTotal) && qty > 0) return estimateTotal / qty;
        return 0;
      })();

      const thumbTextRaw = String(preview.productName || group.reason || 'O').trim();
      const thumbText = thumbTextRaw ? thumbTextRaw.slice(0, 2).toUpperCase() : 'O';

      const card = document.createElement('div');
      card.className = 'co-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open tracking for ${group.reason}`);
      card.dataset.groupId = group.groupId;

      const actionStateClass = allReceived ? 'is-active' : 'is-muted';

      const titleText = String(preview.productName || group.reason || '').trim();
      const subText = preview.productName
        ? `Reason : ${group.reason || ''}`
        : `Created : ${createdDate}`;

      card.innerHTML = `
        <div class="co-top">
          <div class="co-thumb">
            ${
              preview.productImage
                ? `<img src="${escapeHTML(preview.productImage)}" alt=""/>`
                : `<span class="co-thumb-text">${escapeHTML(thumbText)}</span>`
            }
          </div>

          <div class="co-main">
            <div class="co-name">${escapeHTML(titleText)}</div>
            <div class="co-sub">${escapeHTML(subText)}</div>
            <div class="co-price">${formatMoney(unitPrice)}</div>
          </div>

          <div class="co-qty">x${totalQty}</div>
        </div>

        <div class="co-divider"></div>

        <div class="co-bottom">
          <div class="co-est">
            <div class="co-est-label">Estimate Total</div>
            <div class="co-est-value">${formatMoney(estimateTotal)}</div>
          </div>

          <div class="co-actions">
            <div class="co-pill ${actionStateClass}">${escapeHTML(statusText)}</div>
            <div class="co-percent ${actionStateClass}" aria-hidden="true">%</div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openTrackingPage(group));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTrackingPage(group);
        }
      });

      frag.appendChild(card);
    });

    ordersListDiv.appendChild(frag);
  }

  async function fetchAndDisplayOrders() {
    if (!ordersListDiv) return;

    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.data) && (Date.now() - (parsed.ts || 0) < CACHE_TTL_MS)) {
          allOrders = sortByNewest(parsed.data);
          filtered  = allOrders.slice();
          displayOrders(filtered);
          return;
        } else {
          sessionStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {}

    try {
      const response = await fetch('/api/orders', { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/login'; return; }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch orders');
      }
      const data = await response.json();
      allOrders = sortByNewest(Array.isArray(data) ? data : []);
      filtered  = allOrders.slice();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: allOrders }));
      displayOrders(filtered);
    } catch (error) {
      console.error('Error fetching orders:', error);
      ordersListDiv.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
  }

  // مودال احترافي لعناصر الأوردر
  function openOrderModal(orderGroup) {
    if (!orderModalBody || !orderModal) return;

    orderModalBody.innerHTML = `
      <div class="order-modal__head">
        <div class="order-modal__title">
          <i data-feather="clipboard"></i>
          <span>${escapeHTML(orderGroup.reason)}</span>
        </div>
      </div>
      <div class="order-modal__list" id="orderModalList"></div>
    `;

    // انقل زرار X جوّه الهيدر علشان يتمركز رأسيًا
    const headEl = orderModalBody.querySelector('.order-modal__head');
    if (headEl && orderModalClose) {
      orderModalClose.classList.add('close-btn--in-head');
      headEl.appendChild(orderModalClose); // نقل العنصر داخل الهيدر
    }

    const list = document.getElementById('orderModalList');

    orderGroup.products.forEach(product => {
      const item = document.createElement('div');
      item.className = 'order-item-card';
item.innerHTML = `
  <div class="order-item__left">
    <span class="badge badge--name" title="${escapeHTML(product.productName)}">
      ${escapeHTML(product.productName)}
    </span>
  </div>

  <div class="order-item__right">
    <span class="badge badge--qty">Qty: ${Number(product.quantity) || 0}</span>

    ${
      product.status === 'Received'
        ? `<span class="pill pill-green">Received</span>`
        : `<span class="pill pill-muted">Not Received</span>`
    }
  </div>
`;

      list.appendChild(item);
    });

    orderModal.style.display = 'flex';
    if (window.feather) feather.replace();
  }

  function closeOrderModal() {
    if (!orderModal) return;
    orderModal.style.display = 'none';
    // امسح الكاش علشان نرجّع نحمّل أحدث بيانات
    sessionStorage.removeItem(CACHE_KEY);
    fetchAndDisplayOrders();
  }

  async function markAsReceived(event) {
    event.stopPropagation();
    const button = event.target;
    const orderPageId = button.dataset.orderId;
    if (!orderPageId || button.disabled) return;

    button.disabled = true;
    button.textContent = 'Updating...';
    try {
      const response = await fetch('/api/update-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderPageId }),
        credentials: 'include',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Server error');
      button.textContent = 'Received';
      button.classList.add('received');
    } catch (error) {
      console.error('Failed to update status:', error);
      alert('Failed to update status. Please try again.');
      button.textContent = 'Mark as Received';
      button.disabled = false;
    }
  }

  function setupSearch() {
    if (!searchInput) return;
    function runFilter() {
      const q = norm(searchInput.value);
      const base = allOrders;
      filtered = q
        ? base.filter(o =>
            norm(o.reason).includes(q) ||
            norm(o.productName).includes(q)
          )
        : base.slice();
      displayOrders(filtered);
    }
    searchInput.addEventListener('input', runFilter);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = ''; runFilter();
      }
    });
  }

  if (ordersListDiv) {
    fetchAndDisplayOrders();
    setupSearch();
  }
});
