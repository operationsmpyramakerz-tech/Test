// public/js/requested-orders.js
// Operations Requested Orders
// - Cards styled like Current Orders
// - Tabs: Not Started / Received / Delivered
// - Click card => Tracking modal with details + components
// - Download Excel
// - "Received by operations" => sets Status to "Shipped"

document.addEventListener("DOMContentLoaded", () => {
  // List + search
  const listDiv = document.getElementById("requested-list");
  const searchInput = document.getElementById("requestedSearch");
  const tabsWrap = document.getElementById("reqTabs");

  // Tracking modal
  const orderModal = document.getElementById("reqOrderModal");
  const modalClose = document.getElementById("reqModalClose");
  const modalTitle = document.getElementById("reqModalTitle");
  const modalSub = document.getElementById("reqModalSub");
  const modalOrderId = document.getElementById("reqModalOrderId");
  const modalCreatedBy = document.getElementById("reqModalCreatedBy");
  const modalDate = document.getElementById("reqModalDate");
  const modalAssignedTo = document.getElementById("reqModalAssignedTo");
  const modalComponents = document.getElementById("reqModalComponents");
  const modalTotalQty = document.getElementById("reqModalTotalQty");
  const modalTotalPrice = document.getElementById("reqModalTotalPrice");
  const modalItems = document.getElementById("reqModalItems");
  const excelBtn = document.getElementById("reqExcelBtn");
  const receivedBtn = document.getElementById("reqReceivedBtn");

  const stepEls = [
    null,
    document.getElementById("reqStep1"),
    document.getElementById("reqStep2"),
    document.getElementById("reqStep3"),
    document.getElementById("reqStep4"),
    document.getElementById("reqStep5"),
  ];
  const connEls = [
    null,
    document.getElementById("reqConn1"),
    document.getElementById("reqConn2"),
    document.getElementById("reqConn3"),
    document.getElementById("reqConn4"),
  ];

  // Assign modal (keep existing behavior)
  const assignModal = document.getElementById("assignModal");
  const assignClose = document.getElementById("assignClose");
  const assignCancel = document.getElementById("assignCancel");
  const assignApply = document.getElementById("assignApply");
  const assignSelect = document.getElementById("assignSelect");
  let choiceInst = null;

  // Data
  let allItems = [];
  let groups = [];
  let teamMembers = [];
  let selectedGroup = null; // for assignment
  let activeGroup = null; // for tracking modal actions

  // ---------------- Helpers ----------------
  const norm = (s) => String(s || "").toLowerCase().trim();
  const escapeHTML = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  const toMinuteKey = (iso) => String(iso || "").slice(0, 16); // YYYY-MM-DDTHH:MM

  function parseCurrencySymbol() {
    // Default to GBP for the UI (matches current orders)
    return "£";
  }

  const fmtMoney = (n) => {
    const num = Number(n);
    const val = Number.isFinite(num) ? num : 0;
    const sym = parseCurrencySymbol();
    return (
      sym +
      val.toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  };

  const fmtDateOnly = (iso) =>
    new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const fmtDateTime = (iso) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // ---------------- Status / Tracking ----------------
  const STATUS_FLOW = [
    {
      key: "placed",
      label: "Order Placed",
      sub: "We received your order.",
    },
    {
      key: "supervision",
      label: "Under Supervision",
      sub: "Your order is under supervision.",
    },
    {
      key: "progress",
      label: "In progress",
      sub: "We are preparing your order.",
    },
    {
      key: "shipped",
      label: "Shipped",
      sub: "Your order is on the way.",
    },
    {
      key: "arrived",
      label: "Arrived",
      sub: "Your order has arrived.",
    },
  ];

  function statusToIndex(status) {
    const s = norm(status);
    if (/(arrived|delivered|received)/.test(s)) return 5;
    if (/shipped/.test(s)) return 4;
    if (/(in\s*progress|preparing|processing)/.test(s)) return 3;
    if (/under\s*supervision/.test(s)) return 2;
    return 1;
  }

  function computeStage(items) {
    const idx = Math.max(1, ...(items || []).map((it) => statusToIndex(it.status)));
    return { ...(STATUS_FLOW[idx - 1] || STATUS_FLOW[0]), idx };
  }

  function tabFromStageIdx(idx) {
    if (idx >= 5) return "delivered";
    if (idx >= 4) return "received";
    return "not-started";
  }

  function setActiveStep(step) {
    for (let i = 1; i <= 5; i++) {
      const el = stepEls[i];
      if (!el) continue;
      el.classList.toggle("is-done", i < step);
      el.classList.toggle("is-active", i === step);
    }
    for (let i = 1; i <= 4; i++) {
      const el = connEls[i];
      if (!el) continue;
      el.classList.toggle("is-done", i < step);
    }
  }

  // ---------------- Grouping ----------------
  function namesForItem(it) {
    if (Array.isArray(it.assignedToNames)) return it.assignedToNames.filter(Boolean);
    if (it.assignedToName) return [it.assignedToName];
    return [];
  }

  function assignedSummary(g) {
    const names = new Set((g.items || []).flatMap((x) => namesForItem(x)).filter(Boolean));
    if (names.size === 0) return "Unassigned";
    if (names.size === 1) return Array.from(names)[0];
    return "Multiple";
  }

  function computeOrderIdRange(items) {
    const list = (items || [])
      .map((it) => ({
        text: it.orderId || null,
        prefix: it.orderIdPrefix || null,
        number: Number.isFinite(Number(it.orderIdNumber)) ? Number(it.orderIdNumber) : null,
      }))
      .filter((x) => x.text || x.number !== null);

    if (!list.length) return "Order";

    // Prefer numeric unique_id range when possible
    const nums = list.filter((x) => x.number !== null);
    if (nums.length) {
      const prefix = nums[0].prefix || "";
      const samePrefix = nums.every((x) => (x.prefix || "") === prefix);
      const min = Math.min(...nums.map((x) => x.number));
      const max = Math.max(...nums.map((x) => x.number));

      if (min === max) return prefix ? `${prefix}-${min}` : String(min);
      if (samePrefix && prefix) return `${prefix}-${min} : ${prefix}-${max}`;
    }

    // Fallback: use first/last textual ids
    const texts = list.map((x) => x.text).filter(Boolean);
    if (!texts.length) return "Order";
    if (texts.length === 1) return texts[0];
    return `${texts[0]} : ${texts[texts.length - 1]}`;
  }

  function buildGroups(items) {
    const map = new Map();
    for (const it of items || []) {
      const key = `${it.createdById || it.createdByName || ""}|${it.reason || ""}|${toMinuteKey(
        it.createdTime,
      )}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          groupId: it.id,
          reason: it.reason || "",
          createdTime: it.createdTime,
          createdById: it.createdById || "",
          createdByName: it.createdByName || "",
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(it);
      if (new Date(it.createdTime) > new Date(g.createdTime)) {
        g.createdTime = it.createdTime;
        g.groupId = it.id;
      }
    }

    const out = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdTime) - new Date(a.createdTime),
    );

    // compute derived fields
    for (const g of out) {
      g.stage = computeStage(g.items);
      g.tab = tabFromStageIdx(g.stage.idx);
      g.itemsCount = g.items.length;
      g.totalQty = g.items.reduce((sum, x) => sum + (Number(x.quantity) || 0), 0);
      g.estimateTotal = g.items.reduce(
        (sum, x) => sum + (Number(x.quantity) || 0) * (Number(x.unitPrice) || 0),
        0,
      );
      g.orderIdRange = computeOrderIdRange(g.items);
      g.assignedSummary = assignedSummary(g);
    }

    return out;
  }

  function groupMatchesQuery(g, q) {
    if (!q) return true;
    const hay = [
      g.orderIdRange,
      g.reason,
      g.createdByName,
      g.assignedSummary,
      g.stage?.label,
      ...(g.items || []).map((x) => x.productName),
    ]
      .filter(Boolean)
      .join(" ");
    return norm(hay).includes(q);
  }

  // ---------------- Tabs ----------------
  let currentTab = "not-started";
  function readTabFromUrl() {
    const tab = new URLSearchParams(location.search).get("tab");
    const allowed = new Set(["not-started", "received", "delivered"]);
    return allowed.has(tab) ? tab : "not-started";
  }

  function updateTabUI() {
    if (!tabsWrap) return;
    const links = Array.from(tabsWrap.querySelectorAll("a.tab-portfolio"));
    links.forEach((a) => {
      const t = a.getAttribute("data-tab");
      const active = t === currentTab;
      a.classList.toggle("active", active);
      a.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function setActiveTab(tab, opts = {}) {
    currentTab = tab;
    updateTabUI();
    if (opts.updateUrl) {
      const u = new URL(location.href);
      u.searchParams.set("tab", tab);
      history.replaceState({}, "", u.pathname + "?" + u.searchParams.toString());
    }
    filterAndRender();
  }

  // ---------------- Rendering ----------------
  function render() {
    if (!listDiv) return;
    listDiv.innerHTML = "";

    const q = norm(searchInput?.value || "");
    const visible = groups
      .filter((g) => g.tab === currentTab)
      .filter((g) => groupMatchesQuery(g, q));

    if (!visible.length) {
      listDiv.innerHTML = `<p style="color:#6B7280;">No orders found.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const g of visible) {
      const card = document.createElement("div");
      card.className = "co-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Open order ${g.orderIdRange}`);
      card.dataset.key = g.key;

      const dateOnly = fmtDateOnly(g.createdTime);
      const thumbSrc = g.items.find((x) => x.productImage)?.productImage || "";
      const thumbPH = (g.orderIdRange || "OR").split(/\s+/)[0].slice(0, 2).toUpperCase();

      const assignIcon = g.assignedSummary === "Unassigned" ? "user-plus" : "user-check";
      const assignTitle =
        g.assignedSummary === "Unassigned"
          ? "Assign order"
          : `Assigned: ${g.assignedSummary}`;

      card.innerHTML = `
        <div class="co-top">
          <div class="co-thumb">
            ${thumbSrc ? `<img src="${escapeHTML(thumbSrc)}" alt="" />` : `<div class="co-thumb__ph">${escapeHTML(thumbPH)}</div>`}
          </div>
          <div class="co-main">
            <div class="co-title">${escapeHTML(g.orderIdRange)}</div>
            <div class="co-sub">${escapeHTML(dateOnly)}</div>
            <div class="co-price" style="font-size:34px;">${escapeHTML(g.createdByName || "-")}</div>
          </div>
          <div class="co-qty">x${g.itemsCount}</div>
        </div>
        <div class="co-divider"></div>
        <div class="co-bottom">
          <div>
            <div class="co-est-label">Estimate Total</div>
            <div class="co-est-value">${fmtMoney(g.estimateTotal)}</div>
          </div>
          <div class="co-actions">
            <span class="co-status-btn">${escapeHTML(g.stage.label)}</span>
            <button type="button" class="co-right-ico req-assign-btn" data-key="${escapeHTML(
              g.key,
            )}" title="${escapeHTML(assignTitle)}" aria-label="${escapeHTML(
        assignTitle,
      )}" style="padding:0; border:0;">
              <i data-feather="${assignIcon}"></i>
            </button>
          </div>
        </div>
      `;

      // Card interactions
      card.addEventListener("click", () => {
        const gg = groups.find((x) => x.key === g.key);
        if (gg) openOrderModal(gg);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const gg = groups.find((x) => x.key === g.key);
          if (gg) openOrderModal(gg);
        }
      });

      // Assign button (stop click from opening tracking)
      const assignBtn = card.querySelector(".req-assign-btn");
      assignBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const gg = groups.find((x) => x.key === g.key);
        if (!gg) return;
        selectedGroup = { key: gg.key, orderIds: gg.items.map((x) => x.id), items: gg.items };
        openAssignModal(gg);
      });

      frag.appendChild(card);
    }

    listDiv.appendChild(frag);
    if (window.feather) feather.replace();
  }

  function filterAndRender() {
    groups = buildGroups(allItems);
    updateTabUI();
    render();
  }

  // ---------------- Tracking modal ----------------
  function openOrderModal(g) {
    if (!orderModal) return;
    activeGroup = g;

    const stage = g.stage || computeStage(g.items);
    modalTitle.textContent = stage.label;
    modalSub.textContent = stage.sub;
    setActiveStep(stage.idx);

    modalOrderId.textContent = g.orderIdRange || "—";
    modalCreatedBy.textContent = g.createdByName || "—";
    modalDate.textContent = fmtDateTime(g.createdTime);
    modalAssignedTo.textContent = g.assignedSummary || "Unassigned";
    modalComponents.textContent = String(g.itemsCount || g.items.length || 0);
    modalTotalQty.textContent = String(g.totalQty ?? 0);
    modalTotalPrice.textContent = fmtMoney(g.estimateTotal ?? 0);

    // Buttons visibility
    // Only show "Received by operations" before Shipped
    const canMarkReceived = stage.idx < 4;
    if (receivedBtn) receivedBtn.style.display = canMarkReceived ? "inline-flex" : "none";

    // Items
    modalItems.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const it of g.items) {
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitPrice) || 0;
      const lineTotal = qty * unit;
      const itemEl = document.createElement("div");
      itemEl.className = "co-item";
      itemEl.innerHTML = `
        <div class="co-item__main">
          <div class="co-item__name">${escapeHTML(it.productName || "Unknown")}</div>
          <div class="co-item__sub">Reason: ${escapeHTML(it.reason || "-")} · Qty: ${qty} · Unit: ${fmtMoney(unit)}</div>
        </div>
        <div class="co-item__right">
          <div class="co-item__price">${fmtMoney(lineTotal)}</div>
          <span class="co-item__pill">${escapeHTML(it.status || "-")}</span>
        </div>
      `;
      frag.appendChild(itemEl);
    }
    modalItems.appendChild(frag);

    orderModal.classList.add("is-open");
    orderModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("co-modal-open");
    if (window.feather) feather.replace();
  }

  function closeOrderModal() {
    if (!orderModal) return;
    orderModal.classList.remove("is-open");
    orderModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("co-modal-open");
    activeGroup = null;
  }

  // ---------------- Excel download ----------------
  async function downloadExcel(g) {
    if (!g) return;
    if (!excelBtn) return;
    excelBtn.disabled = true;
    const prev = excelBtn.textContent;
    excelBtn.textContent = "Preparing...";
    try {
      const res = await fetch("/api/orders/requested/export/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderIds: g.items.map((x) => x.id) }),
      });
      if (res.status === 401) {
        location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate Excel");
      }

      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const m = disp.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      const fileName =
        decodeURIComponent((m && (m[1] || m[2])) || "") ||
        `order_${(g.orderIdRange || "order").replace(/\s+/g, "_")}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.UI?.toast?.({
        type: "error",
        title: "Export failed",
        message: e.message || "Could not export Excel.",
      });
      alert(e.message || "Could not export Excel.");
    } finally {
      excelBtn.disabled = false;
      excelBtn.textContent = prev;
    }
  }

  // ---------------- Mark received (set status => Shipped) ----------------
  async function markReceivedByOperations(g) {
    if (!g) return;
    if (!receivedBtn) return;
    receivedBtn.disabled = true;
    const prev = receivedBtn.textContent;
    receivedBtn.textContent = "Updating...";

    try {
      const res = await fetch("/api/orders/requested/mark-shipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderIds: g.items.map((x) => x.id) }),
      });
      if (res.status === 401) {
        location.href = "/login";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to update status");
      }

      // Update local state
      const idSet = new Set(g.items.map((x) => x.id));
      allItems.forEach((it) => {
        if (idSet.has(it.id)) it.status = "Shipped";
      });

      // Re-render + move to Received tab
      setActiveTab("received", { updateUrl: true });

      // Update modal contents if still open
      const updated = groups.find((x) => x.key === g.key);
      if (updated) openOrderModal(updated);

      window.UI?.toast?.({
        type: "success",
        title: "Updated",
        message: "Order marked as shipped.",
      });
    } catch (e) {
      window.UI?.toast?.({
        type: "error",
        title: "Update failed",
        message: e.message || "Could not update order.",
      });
      alert(e.message || "Could not update order.");
    } finally {
      receivedBtn.disabled = false;
      receivedBtn.textContent = prev;
    }
  }

  // ---------------- Assign modal ----------------
  async function loadTeamMembers() {
    const r = await fetch("/api/team-members", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) throw new Error("Failed to load team members");
    teamMembers = await r.json();
  }

  function buildSelectOptions(group) {
    assignSelect.innerHTML = (teamMembers || [])
      .map((m) => `<option value="${m.id}">${escapeHTML(m.name)}</option>`)
      .join("");

    // multiple selection
    assignSelect.multiple = true;
    assignSelect.size = Math.min(6, teamMembers.length || 6);

    // preselect if all items share the same assignment
    const names = new Set((group.items || []).flatMap((i) => namesForItem(i)).filter(Boolean));
    if (names.size === 1) {
      const name = Array.from(names)[0];
      const m = teamMembers.find((x) => x.name === name);
      if (m) {
        Array.from(assignSelect.options).forEach((o) => {
          o.selected = o.value === m.id;
        });
      }
    }
  }

  function enhanceSelect() {
    try {
      if (choiceInst && typeof choiceInst.destroy === "function") {
        choiceInst.destroy();
        choiceInst = null;
      }
      if (window.Choices) {
        choiceInst = new Choices(assignSelect, {
          removeItemButton: true,
          shouldSort: false,
          itemSelectText: "",
          searchEnabled: true,
          placeholder: false,
          duplicateItemsAllowed: false,
        });
      }
    } catch {}
  }

  function getSelectedMemberIds() {
    return Array.from(assignSelect?.selectedOptions || [])
      .map((o) => o.value)
      .filter(Boolean);
  }

  function openAssignModal(group) {
    if (!assignModal) return;
    buildSelectOptions(group);
    enhanceSelect();
    assignModal.style.display = "flex";
    if (window.feather) feather.replace();
  }

  function closeAssignModal() {
    if (!assignModal) return;
    assignModal.style.display = "none";
  }

  async function applyAssign(e) {
    e?.preventDefault?.();
    const memberIds = getSelectedMemberIds();
    if (!selectedGroup || !Array.isArray(selectedGroup.orderIds) || !selectedGroup.orderIds.length) {
      alert("No order selected.");
      return;
    }
    if (!memberIds.length) {
      alert("Please choose at least one member.");
      return;
    }

    assignApply.disabled = true;
    const prev = assignApply.textContent;
    assignApply.textContent = "Assigning...";

    try {
      const res = await fetch("/api/orders/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orderIds: selectedGroup.orderIds, memberIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to assign");

      // Update local state
      const chosenList = (teamMembers || []).filter((m) => memberIds.includes(m.id));
      const names = chosenList.map((m) => m.name);
      const ids = chosenList.map((m) => m.id);

      const idSet = new Set(selectedGroup.orderIds);
      allItems.forEach((it) => {
        if (!idSet.has(it.id)) return;
        it.assignedToIds = ids.slice();
        it.assignedToNames = names.slice();
        it.assignedToId = ids[0] || "";
        it.assignedToName = names[0] || "";
      });

      filterAndRender();
      window.UI?.toast?.({
        type: "success",
        title: "Assigned",
        message: "Order assigned successfully.",
      });
      closeAssignModal();
    } catch (e2) {
      alert(e2.message || "Failed to assign.");
    } finally {
      assignApply.disabled = false;
      assignApply.textContent = prev;
    }
  }

  // ---------------- Load data ----------------
  async function loadRequested() {
    try {
      const r = await fetch("/api/orders/requested", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (r.status === 401) {
        location.href = "/login";
        return;
      }
      if (!r.ok) throw new Error("Failed to fetch requested orders");
      const data = await r.json();
      allItems = Array.isArray(data) ? data : [];
      groups = buildGroups(allItems);
      render();
    } catch (e) {
      console.error(e);
      if (listDiv) {
        listDiv.innerHTML = `<p style="color:#B91C1C;">Error: ${escapeHTML(e.message || "Failed to load")}</p>`;
      }
    } finally {
      if (window.feather) feather.replace();
    }
  }

  // ---------------- Events ----------------
  searchInput?.addEventListener("input", () => render());
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      render();
    }
  });

  // Tabs click (keep navigation as-is, but also update UI in case of SPA behavior)
  tabsWrap?.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a.tab-portfolio");
    if (!a) return;
    const t = a.getAttribute("data-tab");
    if (t) {
      currentTab = t;
      updateTabUI();
    }
  });

  // Tracking modal close
  modalClose?.addEventListener("click", closeOrderModal);
  orderModal?.addEventListener("click", (e) => {
    if (e.target === orderModal) closeOrderModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && orderModal?.classList.contains("is-open")) closeOrderModal();
  });

  excelBtn?.addEventListener("click", () => downloadExcel(activeGroup));
  receivedBtn?.addEventListener("click", () => markReceivedByOperations(activeGroup));

  // Assign modal events
  assignClose?.addEventListener("click", closeAssignModal);
  assignCancel?.addEventListener("click", (e) => {
    e.preventDefault();
    closeAssignModal();
  });
  assignModal?.addEventListener("click", (e) => {
    if (e.target === assignModal) closeAssignModal();
  });
  assignApply?.addEventListener("click", applyAssign);

  // ---------------- Init ----------------
  currentTab = readTabFromUrl();
  updateTabUI();

  (async () => {
    try {
      await loadTeamMembers();
    } catch (e) {
      console.warn(e);
    }
    await loadRequested();
  })();
});
