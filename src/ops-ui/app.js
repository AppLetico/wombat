const tokenInput = document.getElementById("tokenInput");
const saveTokenButton = document.getElementById("saveToken");
const authStatus = document.getElementById("authStatus");
const traceTable = document.getElementById("traceTable");
const traceDetail = document.getElementById("traceDetail");
const diffBase = document.getElementById("diffBase");
const diffCompare = document.getElementById("diffCompare");
const runDiffButton = document.getElementById("runDiff");
const diffResult = document.getElementById("diffResult");

const tenantFilter = document.getElementById("tenantFilter");
const workspaceFilter = document.getElementById("workspaceFilter");
const agentFilter = document.getElementById("agentFilter");
const statusFilter = document.getElementById("statusFilter");
const riskFilter = document.getElementById("riskFilter");
const refreshTraces = document.getElementById("refreshTraces");
const promoWorkspace = document.getElementById("promoWorkspace");
const promoSource = document.getElementById("promoSource");
const promoTarget = document.getElementById("promoTarget");
const runPromotionCheckButton = document.getElementById("runPromotionCheck");
const promotionResult = document.getElementById("promotionResult");
const promoAnnotation = document.getElementById("promoAnnotation");
const promoOverride = document.getElementById("promoOverride");
const runPromotionExecuteButton = document.getElementById("runPromotionExecute");
const rollbackWorkspace = document.getElementById("rollbackWorkspace");
const loadVersionsButton = document.getElementById("loadVersions");
const versionList = document.getElementById("versionList");
const rollbackVersion = document.getElementById("rollbackVersion");
const rollbackAnnotation = document.getElementById("rollbackAnnotation");
const runRollbackButton = document.getElementById("runRollback");
const skillSearch = document.getElementById("skillSearch");
const loadSkillsButton = document.getElementById("loadSkills");
const skillList = document.getElementById("skillList");
const skillNameInput = document.getElementById("skillName");
const skillVersionInput = document.getElementById("skillVersion");
const skillStateInput = document.getElementById("skillState");
const promoteSkillButton = document.getElementById("promoteSkill");
const loadCostDashboardButton = document.getElementById("loadCostDashboard");
const costDashboard = document.getElementById("costDashboard");
const loadRiskDashboardButton = document.getElementById("loadRiskDashboard");
const riskDashboard = document.getElementById("riskDashboard");

// Override modal elements
const overrideModal = document.getElementById("overrideModal");
const overrideModalClose = document.getElementById("overrideModalClose");
const overrideReasonCode = document.getElementById("overrideReasonCode");
const overrideJustification = document.getElementById("overrideJustification");
const overrideError = document.getElementById("overrideError");
const overrideCancel = document.getElementById("overrideCancel");
const overrideConfirm = document.getElementById("overrideConfirm");

// Global state for user permissions
let userPermissions = [];
let userRole = null;

// Pending override callback
let pendingOverrideCallback = null;

function getToken() {
  return localStorage.getItem("clasper_ops_token") || "";
}

function setToken(token) {
  localStorage.setItem("clasper_ops_token", token);
}

function headers() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Check if user has a specific permission
 */
function hasPermission(permission) {
  return userPermissions.includes(permission);
}

/**
 * Apply permission-based UI visibility.
 * Hides or disables UI elements based on effective permissions.
 */
function applyPermissions(permissions) {
  userPermissions = permissions || [];

  // Promotion execute button - requires workspace:promote
  if (runPromotionExecuteButton) {
    if (hasPermission("workspace:promote")) {
      runPromotionExecuteButton.disabled = false;
      runPromotionExecuteButton.title = "";
    } else {
      runPromotionExecuteButton.disabled = true;
      runPromotionExecuteButton.title = "Requires workspace:promote permission";
    }
  }

  // Rollback button - requires workspace:rollback
  if (runRollbackButton) {
    if (hasPermission("workspace:rollback")) {
      runRollbackButton.disabled = false;
      runRollbackButton.title = "";
    } else {
      runRollbackButton.disabled = true;
      runRollbackButton.title = "Requires workspace:rollback permission";
    }
  }

  // Skill promote button - requires skill:promote
  if (promoteSkillButton) {
    if (hasPermission("skill:promote")) {
      promoteSkillButton.disabled = false;
      promoteSkillButton.title = "";
    } else {
      promoteSkillButton.disabled = true;
      promoteSkillButton.title = "Requires skill:promote permission (admin only)";
    }
  }

  // Trace diff button - requires trace:diff
  if (runDiffButton) {
    if (hasPermission("trace:diff")) {
      runDiffButton.disabled = false;
      runDiffButton.title = "";
    } else {
      runDiffButton.disabled = true;
      runDiffButton.title = "Requires trace:diff permission";
    }
  }

  // Hide override checkbox for non-operator roles
  const promoOverrideContainer = promoOverride?.parentElement;
  if (promoOverrideContainer) {
    if (hasPermission("override:use")) {
      promoOverrideContainer.style.display = "";
    } else {
      promoOverrideContainer.style.display = "none";
      if (promoOverride) promoOverride.checked = false;
    }
  }
}

/**
 * Show the override modal and return a promise that resolves with override data
 */
function showOverrideModal(message) {
  return new Promise((resolve, reject) => {
    // Reset modal state
    overrideReasonCode.value = "";
    overrideJustification.value = "";
    overrideError.classList.add("hidden");
    overrideError.textContent = "";

    // Update message if provided
    const modalMessage = overrideModal.querySelector(".modal-message");
    if (modalMessage && message) {
      modalMessage.textContent = message;
    }

    // Store callback
    pendingOverrideCallback = { resolve, reject };

    // Show modal
    overrideModal.classList.remove("hidden");
  });
}

/**
 * Hide the override modal
 */
function hideOverrideModal() {
  overrideModal.classList.add("hidden");
  pendingOverrideCallback = null;
}

/**
 * Validate and confirm override
 */
function confirmOverride() {
  const reasonCode = overrideReasonCode.value;
  const justification = overrideJustification.value.trim();

  // Validate
  if (!reasonCode) {
    overrideError.textContent = "Please select a reason code.";
    overrideError.classList.remove("hidden");
    return;
  }
  if (justification.length < 10) {
    overrideError.textContent = "Justification must be at least 10 characters.";
    overrideError.classList.remove("hidden");
    return;
  }

  // Resolve promise with override data
  if (pendingOverrideCallback) {
    pendingOverrideCallback.resolve({
      reason_code: reasonCode,
      justification: justification
    });
  }

  hideOverrideModal();
}

/**
 * Cancel override
 */
function cancelOverride() {
  if (pendingOverrideCallback) {
    pendingOverrideCallback.reject(new Error("Override cancelled"));
  }
  hideOverrideModal();
}

async function fetchMe() {
  try {
    const response = await fetch("/ops/api/me", { headers: headers() });
    if (!response.ok) {
      authStatus.textContent = "Authentication failed";
      applyPermissions([]);
      return;
    }
    const data = await response.json();
    userRole = data.user.role;
    authStatus.textContent = `Authenticated as ${data.user.id} (${data.user.role})`;

    // Apply permission-based UI visibility
    applyPermissions(data.permissions || []);

    if (!tenantFilter.value) {
      tenantFilter.value = data.user.tenant_id || "";
    }
    if (!workspaceFilter.value && data.user.workspace_id) {
      workspaceFilter.value = data.user.workspace_id;
    }
    if (!promoWorkspace.value && data.user.tenant_id) {
      promoWorkspace.value = data.user.tenant_id;
    }
    if (!rollbackWorkspace.value && data.user.tenant_id) {
      rollbackWorkspace.value = data.user.tenant_id;
    }
  } catch (error) {
    authStatus.textContent = "Authentication failed";
    applyPermissions([]);
  }
}

function formatCost(cost) {
  if (cost === undefined || cost === null) return "-";
  return `$${cost.toFixed(4)}`;
}

function renderTraces(traces) {
  if (!traces.length) {
    traceTable.innerHTML = "<div class=\"empty\">No traces found.</div>";
    return;
  }

  const rows = traces
    .map((trace) => `
      <div class="row" data-trace="${trace.id}">
        <div class="cell id">${trace.id}</div>
        <div class="cell">${trace.environment}</div>
        <div class="cell">${trace.agent_role || "-"}</div>
        <div class="cell">${trace.status}</div>
        <div class="cell">${trace.risk.level}</div>
        <div class="cell">${formatCost(trace.cost)}</div>
        <div class="cell">${trace.duration_ms || "-"}</div>
      </div>
    `)
    .join("");

  traceTable.innerHTML = `
    <div class="row header">
      <div class="cell id">Trace ID</div>
      <div class="cell">Env</div>
      <div class="cell">Role</div>
      <div class="cell">Status</div>
      <div class="cell">Risk</div>
      <div class="cell">Cost</div>
      <div class="cell">Duration (ms)</div>
    </div>
    ${rows}
  `;

  traceTable.querySelectorAll(".row[data-trace]").forEach((row) => {
    row.addEventListener("click", () => {
      diffBase.value = row.dataset.trace;
      loadTraceDetail(row.dataset.trace);
    });
  });
}

function renderDetail(trace) {
  // Build linked IDs section with clickable deep links
  const linkedIdsHtml = buildLinkedIdsHtml(trace.linked_ids);

  // Build redaction info section
  const redactionHtml = buildRedactionInfoHtml(trace.redaction_info);

  traceDetail.innerHTML = `
    <div class="detail-block">
      <div><strong>Trace:</strong> ${trace.id}</div>
      <div><strong>Status:</strong> ${trace.status}</div>
      <div><strong>Risk:</strong> ${trace.risk.level} (${trace.risk.score})</div>
      <div><strong>Model:</strong> ${trace.model}</div>
      <div><strong>Cost:</strong> ${formatCost(trace.cost)}</div>
      <div><strong>Environment:</strong> ${trace.environment}</div>
    </div>
    ${linkedIdsHtml}
    <div class="detail-block">
      <strong>Governance Signals</strong>
      <div>Redaction applied: ${trace.governance_signals.redaction_applied ? "Yes" : "No"}</div>
      ${redactionHtml}
      <div>Permission denials: ${trace.governance_signals.permission_denials.length}</div>
    </div>
    <div class="detail-block">
      <strong>Steps</strong>
      <div class="steps">
        ${trace.steps.map((step) => `
          <div class="step">
            <div>${step.type} · ${step.duration_ms}ms</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/**
 * Build HTML for linked identifiers with deep links
 */
function buildLinkedIdsHtml(linkedIds) {
  if (!linkedIds) return "";

  const entries = [];

  if (linkedIds.task_id?.value) {
    const link = linkedIds.task_id.url
      ? `<a href="${linkedIds.task_id.url}" target="_blank" rel="noopener">${linkedIds.task_id.value}</a>`
      : linkedIds.task_id.value;
    entries.push(`<div><strong>Task ID:</strong> ${link}</div>`);
  }

  if (linkedIds.document_id?.value) {
    const link = linkedIds.document_id.url
      ? `<a href="${linkedIds.document_id.url}" target="_blank" rel="noopener">${linkedIds.document_id.value}</a>`
      : linkedIds.document_id.value;
    entries.push(`<div><strong>Document ID:</strong> ${link}</div>`);
  }

  if (linkedIds.message_id?.value) {
    const link = linkedIds.message_id.url
      ? `<a href="${linkedIds.message_id.url}" target="_blank" rel="noopener">${linkedIds.message_id.value}</a>`
      : linkedIds.message_id.value;
    entries.push(`<div><strong>Message ID:</strong> ${link}</div>`);
  }

  if (entries.length === 0) return "";

  return `
    <div class="detail-block">
      <strong>Linked Entities</strong>
      ${entries.join("")}
    </div>
  `;
}

/**
 * Build HTML for redaction info
 */
function buildRedactionInfoHtml(redactionInfo) {
  if (!redactionInfo || !redactionInfo.applied) return "";

  const types = redactionInfo.types_detected?.length > 0
    ? redactionInfo.types_detected.join(", ")
    : "unspecified";

  return `
    <div style="margin-top: 4px; font-size: 12px; color: #f59e0b;">
      Redacted: ${redactionInfo.count} items (${types})
    </div>
  `;
}

async function loadTraces() {
  const params = new URLSearchParams();
  if (tenantFilter.value) params.set("tenant_id", tenantFilter.value);
  if (workspaceFilter.value) params.set("workspace_id", workspaceFilter.value);
  if (agentFilter.value) params.set("agent_role", agentFilter.value);
  if (statusFilter.value) params.set("status", statusFilter.value);
  if (riskFilter.value) params.set("risk_level", riskFilter.value);

  const response = await fetch(`/ops/api/traces?${params.toString()}`, {
    headers: headers()
  });

  if (!response.ok) {
    traceTable.innerHTML = "<div class=\"empty\">Failed to load traces.</div>";
    return;
  }

  const data = await response.json();
  renderTraces(data.traces || []);
}

async function loadTraceDetail(traceId) {
  const params = new URLSearchParams();
  if (tenantFilter.value) params.set("tenant_id", tenantFilter.value);

  const response = await fetch(`/ops/api/traces/${traceId}?${params.toString()}`, {
    headers: headers()
  });

  if (!response.ok) {
    traceDetail.textContent = "Failed to load trace detail.";
    return;
  }

  const data = await response.json();
  renderDetail(data.trace);
}

async function runPromotionChecks() {
  if (!promoWorkspace.value || !promoSource.value || !promoTarget.value) {
    promotionResult.textContent = "Provide workspace ID, source, and target env.";
    return;
  }

  const response = await fetch(`/ops/api/workspaces/${promoWorkspace.value}/promotions/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify({
      source_env: promoSource.value,
      target_env: promoTarget.value
    })
  });

  if (!response.ok) {
    promotionResult.textContent = "Failed to run promotion checks.";
    return;
  }

  const data = await response.json();
  const checks = data.checks?.checks || [];
  const blocked = data.checks?.blocked;

  promotionResult.innerHTML = `
    <strong>${blocked ? "Blocked" : "Ready"}</strong>
    <ul class="checklist">
      ${checks.map((check) => `
        <li>${check.passed ? "✅" : "❌"} ${check.name} ${check.details ? `- ${check.details}` : ""}</li>
      `).join("")}
    </ul>
  `;
}

async function runPromotionExecute() {
  if (!promoWorkspace.value || !promoSource.value || !promoTarget.value) {
    promotionResult.textContent = "Provide workspace ID, source, and target env.";
    return;
  }
  if (!promoAnnotation.value.trim()) {
    promotionResult.textContent = "Annotation is required to execute promotion.";
    return;
  }

  // Build request body
  const requestBody = {
    source_env: promoSource.value,
    target_env: promoTarget.value,
    annotation: {
      key: "note",
      value: promoAnnotation.value.trim()
    }
  };

  // Handle override if checkbox is checked
  if (promoOverride.checked && hasPermission("override:use")) {
    try {
      const overrideData = await showOverrideModal(
        "This promotion requires an override. Please provide a reason and justification."
      );
      requestBody.override = overrideData;
    } catch (e) {
      promotionResult.textContent = "Override cancelled.";
      return;
    }
  }

  const response = await fetch(`/ops/api/workspaces/${promoWorkspace.value}/promotions/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Check if override is required
    if (data.override_required && hasPermission("override:use")) {
      promotionResult.innerHTML = `
        <strong>Promotion blocked</strong>
        <div>${data.error || "Checks failed."}</div>
        <div style="margin-top: 8px;">Check "Override blocks" and try again with justification.</div>
      `;
    } else {
      promotionResult.textContent = data.error || "Promotion failed.";
    }
    return;
  }

  const overrideBadge = data.promotion?.override_used
    ? '<span class="override-badge">Override Used</span>'
    : '';

  promotionResult.innerHTML = `
    <strong>Promotion executed</strong> ${overrideBadge}
    <div>Version: ${data.promotion?.version_hash || "-"}</div>
  `;
}

async function loadVersions() {
  if (!rollbackWorkspace.value) {
    versionList.textContent = "Provide workspace ID.";
    return;
  }

  const response = await fetch(`/ops/api/workspaces/${rollbackWorkspace.value}/versions`, {
    headers: headers()
  });

  if (!response.ok) {
    versionList.textContent = "Failed to load versions.";
    return;
  }

  const data = await response.json();
  const versions = data.versions || [];
  if (!versions.length) {
    versionList.textContent = "No versions found.";
    return;
  }

  versionList.innerHTML = `
    <strong>Versions</strong>
    <ul class="checklist">
      ${versions.map((version) => `
        <li>${version.hash} · ${version.createdAt || version.created_at || "-"}</li>
      `).join("")}
    </ul>
  `;
}

async function runRollback() {
  if (!rollbackWorkspace.value || !rollbackVersion.value || !rollbackAnnotation.value.trim()) {
    versionList.textContent = "Provide workspace, version hash, and annotation.";
    return;
  }

  const response = await fetch(`/ops/api/workspaces/${rollbackWorkspace.value}/rollback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify({
      version_hash: rollbackVersion.value.trim(),
      annotation: {
        key: "note",
        value: rollbackAnnotation.value.trim()
      }
    })
  });

  if (!response.ok) {
    versionList.textContent = "Rollback failed.";
    return;
  }

  const data = await response.json();
  versionList.innerHTML = `<strong>Rollback complete</strong> ${data.version_hash}`;
}

async function loadSkills() {
  const params = new URLSearchParams();
  if (skillSearch.value) params.set("q", skillSearch.value);
  const response = await fetch(`/ops/api/skills/registry?${params.toString()}`, {
    headers: headers()
  });

  if (!response.ok) {
    skillList.textContent = "Failed to load skills.";
    return;
  }

  const data = await response.json();
  const skills = data.skills || [];
  if (!skills.length) {
    skillList.textContent = "No skills found.";
    return;
  }

  skillList.innerHTML = `
    <strong>Skills</strong>
    <ul class="checklist">
      ${skills.map((skill) => `
        <li>${skill.name}@${skill.version} · ${skill.state} · last used ${skill.last_used || "-"}</li>
      `).join("")}
    </ul>
  `;
}

async function promoteSkill() {
  if (!skillNameInput.value || !skillVersionInput.value) {
    skillList.textContent = "Provide skill name and version.";
    return;
  }

  const targetState = skillStateInput.value || "active";
  const response = await fetch(`/ops/api/skills/${skillNameInput.value}/${skillVersionInput.value}/promote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify({ target_state: targetState })
  });

  if (!response.ok) {
    skillList.textContent = "Skill promotion failed.";
    return;
  }

  const data = await response.json();
  skillList.innerHTML = `<strong>Skill promoted</strong> ${data.skill?.name}@${data.skill?.version} → ${data.skill?.state}`;
}

async function loadCostDashboard() {
  const params = new URLSearchParams();
  if (tenantFilter.value) params.set("tenant_id", tenantFilter.value);
  const response = await fetch(`/ops/api/dashboards/cost?${params.toString()}`, {
    headers: headers()
  });

  if (!response.ok) {
    costDashboard.textContent = "Failed to load cost dashboard.";
    return;
  }

  const data = await response.json();
  const daily = data.dashboard?.daily || [];
  const coverage = data.dashboard?.coverage;

  // Build coverage disclaimer if available
  const coverageHtml = coverage
    ? `<div class="coverage-disclaimer">${coverage.disclaimer}</div>`
    : "";

  costDashboard.innerHTML = `
    ${coverageHtml}
    <strong>Daily Cost</strong>
    <ul class="checklist">
      ${daily.map((row) => `
        <li>${row.day}: $${Number(row.total_cost || 0).toFixed(4)} (${row.trace_count})</li>
      `).join("")}
    </ul>
  `;
}

async function loadRiskDashboard() {
  const params = new URLSearchParams();
  if (tenantFilter.value) params.set("tenant_id", tenantFilter.value);
  const response = await fetch(`/ops/api/dashboards/risk?${params.toString()}`, {
    headers: headers()
  });

  if (!response.ok) {
    riskDashboard.textContent = "Failed to load risk dashboard.";
    return;
  }

  const data = await response.json();
  const levels = data.dashboard?.levels || {};
  const coverage = data.dashboard?.coverage;

  // Build coverage disclaimer if available
  const coverageHtml = coverage
    ? `<div class="coverage-disclaimer">${coverage.disclaimer}</div>`
    : "";

  riskDashboard.innerHTML = `
    ${coverageHtml}
    <strong>Risk Levels</strong>
    <ul class="checklist">
      ${Object.entries(levels).map(([level, count]) => `
        <li>${level}: ${count}</li>
      `).join("")}
    </ul>
  `;
}

async function runDiff() {
  if (!diffBase.value || !diffCompare.value) {
    diffResult.textContent = "Provide both trace IDs to run a diff.";
    return;
  }

  const response = await fetch("/ops/api/traces/diff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify({
      base_trace_id: diffBase.value.trim(),
      compare_trace_id: diffCompare.value.trim(),
      include_summary: true
    })
  });

  if (!response.ok) {
    diffResult.textContent = "Failed to diff traces.";
    return;
  }

  const data = await response.json();
  diffResult.innerHTML = `
    <strong>Diff Summary</strong>
    <pre class="diff-summary">${data.summary_text || "No summary available."}</pre>
  `;
}

saveTokenButton.addEventListener("click", () => {
  setToken(tokenInput.value.trim());
  fetchMe();
  loadTraces();
});

refreshTraces.addEventListener("click", () => {
  loadTraces();
});

runDiffButton.addEventListener("click", () => {
  runDiff();
});

runPromotionCheckButton.addEventListener("click", () => {
  runPromotionChecks();
});

runPromotionExecuteButton.addEventListener("click", () => {
  runPromotionExecute();
});

loadVersionsButton.addEventListener("click", () => {
  loadVersions();
});

runRollbackButton.addEventListener("click", () => {
  runRollback();
});

loadSkillsButton.addEventListener("click", () => {
  loadSkills();
});

promoteSkillButton.addEventListener("click", () => {
  promoteSkill();
});

loadCostDashboardButton.addEventListener("click", () => {
  loadCostDashboard();
});

loadRiskDashboardButton.addEventListener("click", () => {
  loadRiskDashboard();
});

// Override modal event listeners
if (overrideModalClose) {
  overrideModalClose.addEventListener("click", cancelOverride);
}
if (overrideCancel) {
  overrideCancel.addEventListener("click", cancelOverride);
}
if (overrideConfirm) {
  overrideConfirm.addEventListener("click", confirmOverride);
}

// Close modal on backdrop click
if (overrideModal) {
  overrideModal.addEventListener("click", (e) => {
    if (e.target === overrideModal) {
      cancelOverride();
    }
  });
}

tokenInput.value = getToken();
fetchMe();
loadTraces();
