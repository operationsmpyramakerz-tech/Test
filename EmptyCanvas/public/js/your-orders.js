// public/js/your-orders.js
// Your Orders page: render each order as a card (matches the reference screenshot)

document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('your-orders-list');
  const searchEl = document.getElementById('yourOrderSearch');

  // This file might be included on other pages; safely bail out.
  if (!listEl) return;

  const escapeHTML = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  const norm = (s) => String(s || '').trim().toLowerCase();

  // Match the screenshot formatting: "$235,00"
  function fmtMoney(value) {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    return `$${safe.toFixed(2).replace('.', ',')}`;
  }

  function stageForStatus(status) {
    const s = norm(status);
    const deliveredSet = new Set(['received', 'delivered']);
    const onTheWaySet = new Set([
      'prepared',
      'on the way',
      'ontheway',
      'on_the_way',
      'shipped',
      'delivering',
    ]);

    if (deliveredSet.has(s)) {
      return { label: 'Delivered', pillClass: 'co-pill is-muted' };
    }
    if (onTheWaySet.has(s)) {
      return { label: 'On the way', pillClass: 'co-pill is-outline' };
    }
    return { label: 'Order Received', pillClass: 'co-pill' };
  }

  function buildCard(order) {
    const title = order.productName || order.reason || '—';

    // If a Size property exists in Notion it will be returned by /api/orders/your as `size`.
    // Otherwise, we show the Reason in the same visual slot.
    const detailLabel = order.size ? 'Size' : 'Reason';
    const detailValue = order.size || order.reason || '—';

    const qty = Number(order.quantity) || 0;
    const price = Number(order.unitPrice) || 0;
    const total = price * qty;

    const st = stageForStatus(order.status);

    const thumbHTML = order.productImage
      ? `<img src="${escapeHTML(order.productImage)}" alt="${escapeHTML(title)}" loading="lazy" />`
      : `<div class="co-thumb__ph">${escapeHTML(String(title).trim().slice(0, 2).toUpperCase())}</div>`;

    const card = document.createElement('article');
    card.className = 'co-card';

    card.innerHTML = `
      <div class="co-top">
        <div class="co-thumb">${thumbHTML}</div>

        <div class="co-main">
          <div class="co-title">${escapeHTML(title)}</div>
          <div class="co-sub">${escapeHTML(detailLabel)} : ${escapeHTML(detailValue)}</div>
          <div class="co-price">${fmtMoney(price)}</div>
        </div>

        <div class="co-qty">x${qty}</div>
      </div>

      <div class="co-divider"></div>

      <div class="co-bottom">
        <div class="co-est">
          <div class="co-est-label">Estimate Total</div>
          <div class="co-est-value">${fmtMoney(total)}</div>
        </div>

        <div class="co-actions">
          <span class="${st.pillClass}">${escapeHTML(st.label)}</span>
          <span class="co-right-ico" aria-hidden="true"><i data-feather="percent"></i></span>
        </div>
      </div>
    `;

    return card;
  }

  function render(list) {
    listEl.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      listEl.innerHTML = '<p>No orders found.</p>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const o of list) frag.appendChild(buildCard(o));
    listEl.appendChild(frag);

    if (window.feather) window.feather.replace();
  }

  let allOrders = [];

  async function load() {
    listEl.innerHTML = '<p><i class="loading-icon" data-feather="loader"></i> Loading orders...</p>';
    if (window.feather) window.feather.replace();

    try {
      const res = await fetch('/api/orders/your', { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch orders');
      }
      const data = await res.json();
      allOrders = Array.isArray(data) ? data : [];
      render(allOrders);
    } catch (e) {
      console.error('Your Orders error:', e);
      listEl.innerHTML = `<p style="color:red;">Error: ${escapeHTML(e.message)}</p>`;
    }
  }

  function setupSearch() {
    if (!searchEl) return;
    const apply = () => {
      const q = norm(searchEl.value);
      if (!q) return render(allOrders);
      const filtered = allOrders.filter((o) => {
        return norm(o.productName).includes(q) || norm(o.reason).includes(q) || norm(o.status).includes(q);
      });
      render(filtered);
    };

    searchEl.addEventListener('input', apply);
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchEl.value) {
        searchEl.value = '';
        apply();
      }
    });
  }

  load();
  setupSearch();
});
