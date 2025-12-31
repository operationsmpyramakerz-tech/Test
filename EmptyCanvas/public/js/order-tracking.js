// public/js/order-tracking.js
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const titleEl = $('trkTitle');
  const subEl = $('trkSubtitle');
  const etaEl = $('trkEta');

  const reasonEl = $('trkReason');
  const itemsCountEl = $('trkItemsCount');
  const totalQtyEl = $('trkTotalQty');
  const estimateTotalEl = $('trkEstimateTotal');
  const itemsEl = $('trkItems');

  const step1 = $('trkStep1');
  const step2 = $('trkStep2');
  const step3 = $('trkStep3');
  const conn1 = $('trkConn1');
  const conn2 = $('trkConn2');

  const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const formatMoney = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '£0.00';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
    } catch {
      return `£${n.toFixed(2)}`;
    }
  };

  function formatTimeMaybe(v) {
    // If v is an ISO date string, show HH:MM.
    // If v is already like '09:20', keep it.
    if (!v) return '--:--';
    const s = String(v).trim();
    if (/^\d{1,2}:\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function setStage(stage) {
    // stage: 1 = placed, 2 = on the way, 3 = delivered
    step1?.classList.add('active');

    if (stage >= 2) {
      conn1?.classList.add('active');
      step2?.classList.add('active');
    } else {
      conn1?.classList.remove('active');
      step2?.classList.remove('active');
    }

    if (stage >= 3) {
      conn2?.classList.add('active');
      step3?.classList.add('active');
    } else {
      conn2?.classList.remove('active');
      step3?.classList.remove('active');
    }
  }

  async function load() {
    const params = new URLSearchParams(window.location.search);
    const groupId = params.get('groupId');

    if (!groupId) {
      titleEl.textContent = 'Missing order';
      subEl.textContent = 'No tracking info: groupId is missing.';
      return;
    }

    try {
      const res = await fetch(`/api/orders/tracking?groupId=${encodeURIComponent(groupId)}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load tracking info');
      }

      titleEl.textContent = data.headerTitle || 'On the way';
      subEl.textContent = data.headerSubtitle || '';

      setStage(Number(data.stage) || 2);

      reasonEl.textContent = data.reason || '—';
      itemsCountEl.textContent = String(data.totals?.itemsCount ?? '—');
      totalQtyEl.textContent = String(data.totals?.totalQty ?? '—');
      estimateTotalEl.textContent = formatMoney(data.totals?.estimateTotal ?? 0);

      // ETA: prefer explicit ETA prop; fallback to created time (time only)
      const etaValue = data.eta || data.createdTime;
      etaEl.textContent = formatTimeMaybe(etaValue);

      // Render items list (optional)
      const items = Array.isArray(data.items) ? data.items : [];
      if (!itemsEl) return;

      if (items.length === 0) {
        itemsEl.innerHTML = '';
      } else {
        itemsEl.innerHTML = items.map((it) => {
          const status = String(it.status || 'Pending');
          const st = status.toLowerCase();
          const cls = st.includes('received') && !st.includes('not received') ? 'ok' : 'wait';

          return `
            <div class="trk-item">
              <div>
                <div class="name">${escapeHTML(it.productName || 'Unknown Product')}</div>
                <div class="meta">Qty: ${Number(it.quantity) || 0}</div>
              </div>
              <div class="trk-pill-status ${cls}">${escapeHTML(status)}</div>
            </div>
          `;
        }).join('');
      }

      if (window.feather) feather.replace();
    } catch (e) {
      console.error(e);
      titleEl.textContent = 'Error';
      subEl.textContent = e.message || 'Failed to load tracking info';
      etaEl.textContent = '--:--';
      setStage(1);
    }
  }

  load();
});
