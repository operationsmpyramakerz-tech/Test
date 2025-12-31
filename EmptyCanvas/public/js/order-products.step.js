// public/js/order-products.step.js
// Create New Order (Products) — Shopping Cart UI
(() => {
  /**
   * Data model in session draft:
   * [{ id: string, quantity: number, reason: string }]
   */

  // ---------------------------- DOM ----------------------------
  const cartItemsEl = document.getElementById('cartItems');
  const updateCartBtn = document.getElementById('updateCartBtn');
  const checkoutBtn = document.getElementById('checkoutBtn');

  const voucherInput = document.getElementById('voucherInput');
  const applyVoucherBtn = document.getElementById('applyVoucherBtn');
  const summarySubTotalEl = document.getElementById('summarySubTotal');
  const summaryDiscountEl = document.getElementById('summaryDiscount');
  const summaryDeliveryEl = document.getElementById('summaryDelivery');
  const summaryTotalEl = document.getElementById('summaryTotal');
  const summaryDiscountLabelEl = document.getElementById('summaryDiscountLabel');

  const modalEl = document.getElementById('updateCartModal');
  const modalCloseBtn = document.getElementById('updateCartClose');
  const addToCartBtn = document.getElementById('addToCartBtn');
  const componentSelectEl = document.getElementById('cartComponentSelect');
  const qtyInputEl = document.getElementById('cartQtyInput');
  const reasonInputEl = document.getElementById('cartReasonInput');

  const savingOverlayEl = document.getElementById('cartSavingOverlay');
  const savingTextEl = document.getElementById('cartSavingText');

  if (!cartItemsEl) {
    console.warn('[order-products] Missing #cartItems — page markup mismatch.');
  }

  // ---------------------------- UI helpers ----------------------------
  function toast(type, title, message) {
    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast({ type, title, message });
      return;
    }
    // Fallback
    alert([title, message].filter(Boolean).join('\n'));
  }

  function showSaving(text = 'Saving...') {
    if (!savingOverlayEl) return;
    if (savingTextEl) savingTextEl.textContent = text;
    savingOverlayEl.style.display = 'flex';
    savingOverlayEl.setAttribute('aria-hidden', 'false');
  }

  function hideSaving() {
    if (!savingOverlayEl) return;
    savingOverlayEl.style.display = 'none';
    savingOverlayEl.setAttribute('aria-hidden', 'true');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const hasDecimals = Math.abs(n - Math.round(n)) > 1e-9;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: hasDecimals ? 2 : 0,
      }).format(n);
    } catch {
      // In case Intl is unavailable
      const fixed = hasDecimals ? n.toFixed(2) : String(Math.round(n));
      return '$' + fixed;
    }
  }

  // ---------------------------- State ----------------------------
  let components = []; // [{id,name,url,unitPrice,imageUrl}]
  let byId = new Map();
  let cart = []; // draft products

  let discountPercent = 0; // 0 or 0.10
  const deliveryFee = 0; // keep 0 by default (design-only line)

  let choicesInst = null;
  let saveTimer = null;
  let isSavingNow = false;
  let editingId = null; // when modal opened for editing an existing cart item

  // ---------------------------- Data loading ----------------------------
  async function loadComponents() {
    try {
      const res = await fetch('/api/components');
      if (!res.ok) throw new Error(await res.text());
      const list = await res.json();
      components = Array.isArray(list) ? list : [];
      byId = new Map(components.map((c) => [String(c.id), c]));
    } catch (err) {
      console.error('Failed to load components:', err);
      components = [];
      byId = new Map();
      toast('error', 'Error', 'Failed to load components list.');
    }
  }

  async function loadDraft() {
    try {
      const res = await fetch('/api/order-draft');
      if (!res.ok) return;
      const d = await res.json();
      const list = Array.isArray(d.products) ? d.products : [];
      cart = list
        .map((p) => ({
          id: String(p.id || ''),
          quantity: Math.max(1, Number(p.quantity) || 1),
          reason: String(p.reason || '').trim(),
        }))
        .filter((p) => p.id);
    } catch {
      // ignore
    }
  }

  // ---------------------------- Draft persistence ----------------------------
  function scheduleSaveDraft() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      persistDraft({ silent: true });
    }, 500);
  }

  async function persistDraft({ silent = false } = {}) {
    if (isSavingNow) return false;
    isSavingNow = true;
    try {
      if (!Array.isArray(cart) || cart.length === 0) {
        // Clear draft on server
        await fetch('/api/order-draft', { method: 'DELETE' });
        return true;
      }

      // Ensure reasons exist (server requires it)
      const clean = cart
        .map((p) => ({
          id: String(p.id),
          quantity: Math.max(1, Number(p.quantity) || 1),
          reason: String(p.reason || '').trim(),
        }))
        .filter((p) => p.id);

      const res = await fetch('/api/order-draft/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: clean }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) toast('error', 'Error', data?.error || 'Failed to save cart.');
        return false;
      }
      return true;
    } catch (err) {
      console.error('persistDraft error:', err);
      if (!silent) toast('error', 'Error', 'Failed to save cart.');
      return false;
    } finally {
      isSavingNow = false;
    }
  }

  // ---------------------------- Rendering ----------------------------
  function unitPriceOf(id) {
    const c = byId.get(String(id));
    const n = Number(c?.unitPrice);
    return Number.isFinite(n) ? n : 0;
  }

  function itemTotal(p) {
    return unitPriceOf(p.id) * (Number(p.quantity) || 0);
  }

  function updateSummary() {
    const subtotal = cart.reduce((sum, p) => sum + itemTotal(p), 0);
    const discount = subtotal * (discountPercent || 0);
    const total = subtotal - discount + deliveryFee;

    if (summarySubTotalEl) summarySubTotalEl.textContent = formatMoney(subtotal);
    if (summaryDeliveryEl) summaryDeliveryEl.textContent = formatMoney(deliveryFee);
    if (summaryTotalEl) summaryTotalEl.textContent = formatMoney(total);

    if (summaryDiscountLabelEl) {
      summaryDiscountLabelEl.textContent = discountPercent > 0 ? `Discount (${Math.round(discountPercent * 100)}%)` : 'Discount';
    }
    if (summaryDiscountEl) {
      // show negative value when discount is applied
      summaryDiscountEl.textContent = discount > 0 ? '-' + formatMoney(discount) : formatMoney(0);
    }
  }

  function renderEmptyState() {
    cartItemsEl.innerHTML = `
      <div class="cart-empty">
        <strong>Your cart is empty</strong>
        <div>Click <b>Update Cart</b> to add a component.</div>
      </div>
    `;
  }

  function renderCart() {
    if (!cartItemsEl) return;

    cartItemsEl.innerHTML = '';

    if (!Array.isArray(cart) || cart.length === 0) {
      renderEmptyState();
      updateSummary();
      if (window.feather) feather.replace();
      return;
    }

    for (const p of cart) {
      const c = byId.get(String(p.id)) || null;
      const name = c?.name || 'Unknown component';
      const reason = String(p.reason || '').trim();
      const qty = Math.max(1, Number(p.quantity) || 1);
      const total = itemTotal({ id: p.id, quantity: qty, reason });

      const row = document.createElement('div');
      row.className = 'cart-row';
      row.dataset.id = String(p.id);

      // Product cell
      const productCell = document.createElement('div');
      productCell.className = 'cart-product';

      const thumb = document.createElement('div');
      thumb.className = 'cart-thumb';
      if (c?.imageUrl) {
        const img = document.createElement('img');
        img.alt = name;
        img.loading = 'lazy';
        img.src = c.imageUrl;
        thumb.appendChild(img);
      } else {
        // fallback: first letter
        const letter = (String(name).trim()[0] || '•').toUpperCase();
        thumb.textContent = letter;
      }

      const meta = document.createElement('div');
      meta.className = 'prod-meta';
      meta.innerHTML = `
        <div class="prod-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="prod-reason" title="${escapeHtml(reason || '-')}">${escapeHtml(reason || '-')}</div>
      `;

      productCell.appendChild(thumb);
      productCell.appendChild(meta);

      // Quantity cell
      const qtyCell = document.createElement('div');
      const qtyCtl = document.createElement('div');
      qtyCtl.className = 'qty-control';

      const decBtn = document.createElement('button');
      decBtn.className = 'qty-btn';
      decBtn.type = 'button';
      decBtn.textContent = '−';
      decBtn.setAttribute('aria-label', 'Decrease quantity');

      const qtyVal = document.createElement('div');
      qtyVal.className = 'qty-value';
      qtyVal.textContent = String(qty);

      const incBtn = document.createElement('button');
      incBtn.className = 'qty-btn';
      incBtn.type = 'button';
      incBtn.textContent = '+';
      incBtn.setAttribute('aria-label', 'Increase quantity');

      qtyCtl.appendChild(decBtn);
      qtyCtl.appendChild(qtyVal);
      qtyCtl.appendChild(incBtn);
      qtyCell.appendChild(qtyCtl);

      // Total cell
      const totalCell = document.createElement('div');
      totalCell.className = 'money';
      totalCell.textContent = formatMoney(total);

      // Action cell
      const actionCell = document.createElement('div');
      const trashBtn = document.createElement('button');
      trashBtn.className = 'trash-btn';
      trashBtn.type = 'button';
      trashBtn.setAttribute('aria-label', 'Remove item');
      trashBtn.innerHTML = '<i data-feather="trash-2"></i>';
      actionCell.appendChild(trashBtn);

      // bind events
      incBtn.addEventListener('click', () => {
        changeQty(p.id, +1);
      });
      decBtn.addEventListener('click', () => {
        changeQty(p.id, -1);
      });
      trashBtn.addEventListener('click', () => {
        removeItem(p.id);
      });

      // Optional: click product area to edit this item in modal
      productCell.style.cursor = 'pointer';
      productCell.addEventListener('click', () => openModalForEdit(p.id));

      row.appendChild(productCell);
      row.appendChild(qtyCell);
      row.appendChild(totalCell);
      row.appendChild(actionCell);

      cartItemsEl.appendChild(row);
    }

    updateSummary();
    if (window.feather) feather.replace();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---------------------------- Cart mutations ----------------------------
  function changeQty(id, delta) {
    const idx = cart.findIndex((p) => String(p.id) === String(id));
    if (idx === -1) return;
    const cur = Math.max(1, Number(cart[idx].quantity) || 1);
    const next = cur + Number(delta || 0);
    if (next <= 0) {
      removeItem(id);
      return;
    }
    cart[idx].quantity = next;
    renderCart();
    scheduleSaveDraft();
  }

  function removeItem(id) {
    cart = cart.filter((p) => String(p.id) !== String(id));
    renderCart();
    scheduleSaveDraft();
  }

  function upsertItem({ id, quantity, reason }) {
    const cleanId = String(id || '');
    const cleanQty = Math.max(1, Number(quantity) || 1);
    const cleanReason = String(reason || '').trim();

    if (!cleanId) {
      toast('error', 'Missing field', 'Please choose a component.');
      return false;
    }
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
      toast('error', 'Missing field', 'Please enter a valid quantity.');
      return false;
    }
    if (!cleanReason) {
      toast('error', 'Missing field', 'Please enter a reason.');
      return false;
    }

    const idx = cart.findIndex((p) => String(p.id) === cleanId);
    if (idx >= 0) {
      cart[idx].quantity = cleanQty;
      cart[idx].reason = cleanReason;
    } else {
      cart.push({ id: cleanId, quantity: cleanQty, reason: cleanReason });
    }
    return true;
  }

  // ---------------------------- Modal ----------------------------
  function setModalOpen(open) {
    if (!modalEl) return;
    modalEl.style.display = open ? 'flex' : 'none';
    modalEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function openModalForAdd() {
    editingId = null;
    if (addToCartBtn) addToCartBtn.textContent = 'Add';
    if (!components.length) {
      toast('error', 'No components', 'Components list is empty.');
      return;
    }
    // reset inputs
    if (qtyInputEl) qtyInputEl.value = '1';
    if (reasonInputEl) reasonInputEl.value = '';

    // reset select
    if (choicesInst) {
      choicesInst.removeActiveItems();
    } else if (componentSelectEl) {
      componentSelectEl.value = '';
    }

    setModalOpen(true);
    // Focus select
    window.setTimeout(() => {
      try {
        const focusEl = modalEl.querySelector('.choices__inner') || componentSelectEl;
        focusEl?.focus?.();
      } catch {}
    }, 50);
  }

  function openModalForEdit(id) {
    const item = cart.find((p) => String(p.id) === String(id));
    if (!item) {
      openModalForAdd();
      return;
    }

    editingId = String(item.id);
    if (addToCartBtn) addToCartBtn.textContent = 'Update';
    if (qtyInputEl) qtyInputEl.value = String(Math.max(1, Number(item.quantity) || 1));
    if (reasonInputEl) reasonInputEl.value = String(item.reason || '').trim();

    // set select to item component
    if (choicesInst) {
      try {
        choicesInst.setChoiceByValue(String(item.id));
      } catch {
        // fallback
        componentSelectEl.value = String(item.id);
      }
    } else if (componentSelectEl) {
      componentSelectEl.value = String(item.id);
    }

    setModalOpen(true);
  }

  function closeModal() {
    editingId = null;
    setModalOpen(false);
  }

  function initComponentChoices() {
    if (!componentSelectEl) return;

    // Build options
    componentSelectEl.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.disabled = true;
    ph.selected = true;
    ph.textContent = components.length ? 'Select component...' : 'No components available';
    componentSelectEl.appendChild(ph);
    for (const c of components) {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = String(c.name || '');
      componentSelectEl.appendChild(opt);
    }

    // Choices
    try {
      if (choicesInst) {
        choicesInst.destroy();
        choicesInst = null;
      }
      choicesInst = new Choices(componentSelectEl, {
        searchEnabled: true,
        placeholder: true,
        placeholderValue: 'Select component...',
        itemSelectText: '',
        shouldSort: true,
        allowHTML: false,
        position: 'bottom',
        searchResultLimit: 500,
      });
    } catch (e) {
      console.warn('Choices init failed:', e);
      choicesInst = null;
    }
  }

  // ---------------------------- Voucher (design-only) ----------------------------
  function applyVoucher() {
    const code = String(voucherInput?.value || '').trim();
    if (!code) {
      discountPercent = 0;
      updateSummary();
      toast('info', 'Voucher', 'Voucher cleared.');
      return;
    }

    // Simple behavior: any non-empty code enables 10% discount
    discountPercent = 0.1;
    updateSummary();
    toast('success', 'Voucher applied', 'Discount applied to your cart.');
  }

  // ---------------------------- Checkout ----------------------------
  async function checkout() {
    if (!Array.isArray(cart) || cart.length === 0) {
      toast('error', 'Empty cart', 'Please add at least one component.');
      return;
    }

    // Ensure all items have reason
    const missingReason = cart.find((p) => !String(p.reason || '').trim());
    if (missingReason) {
      toast('error', 'Missing field', 'Reason is required for all items.');
      openModalForEdit(missingReason.id);
      return;
    }

    showSaving('Saving cart...');
    const ok = await persistDraft({ silent: false });
    hideSaving();
    if (!ok) return;

    window.location.href = '/orders/new/review';
  }

  // ---------------------------- Bindings ----------------------------
  function bindEvents() {
    updateCartBtn?.addEventListener('click', openModalForAdd);
    modalCloseBtn?.addEventListener('click', closeModal);

    // Close modal when clicking backdrop
    modalEl?.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    // Esc closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl && modalEl.style.display === 'flex') {
        closeModal();
      }
    });

    addToCartBtn?.addEventListener('click', async () => {
      const id = componentSelectEl?.value;
      const qty = Number(qtyInputEl?.value);
      const reason = reasonInputEl?.value;

      // If we opened the modal from an existing item and the user changed
      // the selected component, remove the old item first to avoid duplicates.
      if (editingId && String(editingId) !== String(id)) {
        cart = cart.filter((p) => String(p.id) !== String(editingId));
      }

      const ok = upsertItem({ id, quantity: qty, reason });
      if (!ok) return;

      closeModal();
      renderCart();

      // persist immediately (feels snappier)
      const saved = await persistDraft({ silent: true });
      if (!saved) toast('error', 'Error', 'Failed to save cart.');
    });

    applyVoucherBtn?.addEventListener('click', applyVoucher);
    checkoutBtn?.addEventListener('click', checkout);
  }

  // ---------------------------- Init ----------------------------
  async function init() {
    bindEvents();
    await loadComponents();
    initComponentChoices();
    await loadDraft();
    renderCart();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
