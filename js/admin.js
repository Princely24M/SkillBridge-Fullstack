(function () {
  const page = document.body.dataset.adminPage;
  const apiBase = window.SkillBridgeAPI?.getDefaultBaseUrl() || '/api';

  function isNetworkFetchError(error) {
    return /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''));
  }

  function createSupabaseConnectionError() {
    return new Error('Unable to reach Supabase Auth. Check your internet connection and confirm the Supabase project is active.');
  }

  function isAdminPage() {
    return Boolean(page);
  }

  async function getSupabaseClient() {
    let response;
    try {
      response = await fetch(`${apiBase.replace(/\/$/, '')}/auth-config`, { headers: { Accept: 'application/json' } });
    } catch (error) {
      if (error.message === 'Failed to fetch') {
        throw new Error(`Unable to reach the SkillBridge API at ${apiBase}. Start the API server and reload.`);
      }
      throw error;
    }
    const config = await response.json();
    if (!response.ok || !config.supabaseUrl || !config.publishableKey || !window.supabase?.createClient) {
      throw new Error('Admin authentication is not configured.');
    }
    return window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  function getAuthToken() {
    return window.sessionStorage.getItem('skillbridge_admin_session') || '';
  }

  function setAuthToken(token) {
    if (token) {
      window.sessionStorage.setItem('skillbridge_admin_session', token);
    } else {
      window.sessionStorage.removeItem('skillbridge_admin_session');
    }
  }

  function showAdminAccessError(message) {
    const container = document.querySelector('.admin-content') || document.querySelector('main');
    if (!container) return;

    const notice = document.createElement('p');
    notice.className = 'auth-message';
    notice.setAttribute('role', 'alert');
    notice.textContent = message;
    container.prepend(notice);
  }

  async function ensureAdminAuthed() {
    if (!isAdminPage()) return true;
    const token = getAuthToken();
    if (!token) {
      window.location.replace('login.html');
      return false;
    }

    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/me', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });
      const role = response?.user?.role || 'candidate';
      if (role !== 'admin' && role !== 'super_admin') {
        setAuthToken('');
        window.location.replace('login.html');
        return false;
      }
      return true;
    } catch (error) {
      if (error.message === 'Authentication required.') {
        setAuthToken('');
        window.location.replace('login.html');
        return false;
      }

      if (error.message === 'You do not have permission to access the admin area.'
        || error.message === 'This account is not active.') {
        setAuthToken('');
        showAdminAccessError(error.message === 'This account is not active.'
          ? 'This account is not active. Contact a Supabase project administrator for help.'
          : 'This account no longer has admin access. Contact a Supabase project administrator.');
        return false;
      }

      const message = error.message === 'Failed to fetch'
        ? `Unable to reach the admin API at ${apiBase}. Check that the API server is running, then reload.`
        : `Unable to verify admin access. ${error.message || 'Please reload and try again.'}`;
      showAdminAccessError(message);
      return false;
    }
  }

  function updateRoleLabel(role) {
    document.querySelectorAll('[data-admin-role]').forEach((node) => {
      node.textContent = role === 'super_admin' ? 'Super admin' : 'Admin';
    });
  }

  async function initializeAdminLogin() {
    const form = document.getElementById('admin-login-form');
    const message = document.querySelector('[data-auth-message]');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;

      if (!email || !password) {
        message.hidden = false;
        message.textContent = 'Enter both your email and password.';
        message.dataset.kind = 'error';
        return;
      }

      try {
        const authClient = await getSupabaseClient();
        let signInResult;
        try {
          signInResult = await authClient.auth.signInWithPassword({ email, password });
        } catch (authError) {
          if (isNetworkFetchError(authError)) throw createSupabaseConnectionError();
          throw authError;
        }

        const { data, error } = signInResult;
        if (error) {
          if (isNetworkFetchError(error)) throw createSupabaseConnectionError();
          throw new Error(error.message || 'Admin sign in failed.');
        }
        if (!data.session) {
          throw new Error('Admin sign in failed.');
        }

        try {
          await window.SkillBridgeAPI.requestJson('admin/me', {
            baseUrl: apiBase,
            headers: { Authorization: `Bearer ${data.session.access_token}` }
          });
        } catch (accessError) {
          if (accessError.message === 'You do not have permission to access the admin area.') {
            throw new Error('This account is valid, but it does not have admin access. Ask a Supabase project administrator to grant the admin role.');
          }
          if (accessError.message === 'Failed to fetch') {
            throw new Error(`Supabase sign-in succeeded, but the SkillBridge admin API at ${apiBase} is unreachable. Keep the API server running and try again.`);
          }
          throw accessError;
        }

        setAuthToken(data.session.access_token);
        window.location.assign('dashboard.html');
      } catch (error) {
        message.hidden = false;
        message.dataset.kind = 'error';
        message.textContent = error.message || 'Unable to sign in with the supplied admin credentials.';
      }
    });
  }

  async function initializeAdminDashboard() {
    const metricsContainer = document.querySelector('[data-admin-metrics]');
    const activityList = document.querySelector('[data-admin-activity]');
    if (!metricsContainer && !activityList) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();
    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/metrics', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });

      updateRoleLabel(response.user?.role || 'admin');
      const metrics = response.metrics || {};
      const totalUsers = Number.isFinite(metrics.totalUsers) ? metrics.totalUsers : Number.isFinite(metrics.activeCandidateAccounts) ? metrics.activeCandidateAccounts : 0;
      const totalUsersNode = document.querySelector('[data-metric="totalUsers"]');
      const activeCandidatesNode = document.querySelector('[data-metric="activeCandidates"]');
      const totalOpportunitiesNode = document.querySelector('[data-metric="totalOpportunities"]');
      const publishedNode = document.querySelector('[data-metric="publishedOpportunities"]');
      const draftNode = document.querySelector('[data-metric="draftOpportunities"]');
      const expiredNode = document.querySelector('[data-metric="expiredOpportunities"]');
      const awaitingNode = document.querySelector('[data-metric="awaitingReview"]');
      const lastUpdatedNode = document.querySelector('[data-last-updated]');
      const chartUsersNode = document.querySelector('[data-chart-users]');
      const chartOpportunitiesNode = document.querySelector('[data-chart-opportunities]');

      if (totalUsersNode) totalUsersNode.textContent = String(totalUsers);
      if (activeCandidatesNode) activeCandidatesNode.textContent = String(metrics.activeCandidateAccounts ?? 0);
      if (totalOpportunitiesNode) totalOpportunitiesNode.textContent = String(metrics.totalOpportunities ?? 0);
      if (publishedNode) publishedNode.textContent = String(metrics.publishedOpportunities ?? 0);
      if (draftNode) draftNode.textContent = String(metrics.draftOpportunities ?? 0);
      if (expiredNode) expiredNode.textContent = String(metrics.expiredOpportunities ?? 0);
      if (awaitingNode) awaitingNode.textContent = String(metrics.awaitingReview ?? 0);
      if (lastUpdatedNode) lastUpdatedNode.textContent = new Date(response.generatedAt || Date.now()).toLocaleString();
      if (chartUsersNode) chartUsersNode.textContent = String(totalUsers);
      if (chartOpportunitiesNode) chartOpportunitiesNode.textContent = String(metrics.totalOpportunities ?? 0);

    } catch (error) {
      if (metricsContainer) {
        metricsContainer.innerHTML = '<article class="admin-stat-card"><span>Error</span><strong>--</strong><small>Unable to load metrics.</small></article>';
      }
    }
  }

  async function initializeAdminReports() {
    const reportsContainer = document.querySelector('[data-admin-reports]');
    if (!reportsContainer) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();
    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/reports', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });

      const summary = response.summary || {};
      const usersNode = document.querySelector('[data-report-users]');
      const opportunitiesNode = document.querySelector('[data-report-opportunities]');
      const pendingNode = document.querySelector('[data-report-pending]');
      if (usersNode) usersNode.textContent = String(summary.totalUsers ?? 0);
      if (opportunitiesNode) opportunitiesNode.textContent = String(summary.totalOpportunities ?? 0);
      if (pendingNode) pendingNode.textContent = String(summary.awaitingReview ?? 0);
    } catch (error) {
      const usersNode = document.querySelector('[data-report-users]');
      const opportunitiesNode = document.querySelector('[data-report-opportunities]');
      const pendingNode = document.querySelector('[data-report-pending]');
      if (usersNode) usersNode.textContent = '--';
      if (opportunitiesNode) opportunitiesNode.textContent = '--';
      if (pendingNode) pendingNode.textContent = '--';
    }
  }

  async function initializeAdminActivity() {
    const activityList = document.querySelector('[data-admin-activity]');
    if (!activityList) return;
    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const isActivityPage = page === 'activity';
    const pageSize = isActivityPage ? 25 : 5;
    const message = document.querySelector('[data-audit-message]');
    const totalNode = document.querySelector('[data-audit-total]');
    const pageInfo = document.querySelector('[data-audit-page-info]');
    const previousButton = document.querySelector('[data-audit-prev]');
    const nextButton = document.querySelector('[data-audit-next]');
    const dialog = document.querySelector('[data-audit-dialog]');
    const detailsNode = document.querySelector('[data-audit-details]');
    const controls = {
      range: document.querySelector('[data-audit-range]'),
      from: document.querySelector('[data-audit-from]'),
      to: document.querySelector('[data-audit-to]'),
      actor: document.querySelector('[data-audit-actor]'),
      action: document.querySelector('[data-audit-action]'),
      entity_type: document.querySelector('[data-audit-resource]'),
      status: document.querySelector('[data-audit-status]'),
      q: document.querySelector('[data-audit-search]')
    };
    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const actionLabels = {
      'user.created': 'User created',
      'user.updated': 'User updated',
      'user.role_changed': 'Role changed',
      'user.status_changed': 'Account status changed',
      'user.deleted': 'User deleted',
      'opportunity.created': 'Opportunity created',
      'opportunity.updated': 'Opportunity updated',
      'opportunity.status_changed': 'Opportunity status changed',
      'opportunity.deleted': 'Opportunity deleted'
    };
    const formatDate = (value) => {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date';
    };
    let currentPage = 1;
    let events = [];
    let loading = false;
    let searchTimer;

    function renderDetails(event) {
      const oldValues = event.old_values && typeof event.old_values === 'object' ? event.old_values : {};
      const newValues = event.new_values && typeof event.new_values === 'object' ? event.new_values : {};
      const fields = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
        .filter((field) => oldValues[field] !== newValues[field]);
      const names = {
        full_name: 'Full name', email: 'Email', role: 'Role', status: 'Account status',
        title: 'Title', organisation: 'Organisation', category: 'Category', location: 'Location',
        closing_date: 'Closing date', experience_level: 'Experience level',
        description: 'Description', application_instructions: 'Application instructions',
        source_name: 'Source name', verification_level: 'Verification level',
        opportunity_status: 'Opportunity status', verification_status: 'Verification status',
        is_verified: 'Verified'
      };
      const changes = fields.length
        ? `<h3>Changes</h3><dl class="audit-change-list">${fields.map((field) => `
            <div><dt>${escapeHtml(names[field] || field.replace(/_/g, ' '))}</dt>
              <dd>${escapeHtml(oldValues[field] ?? '—')} <span aria-hidden="true">→</span> <strong>${escapeHtml(newValues[field] ?? '—')}</strong></dd>
            </div>`).join('')}</dl>`
        : '<p>No field changes were recorded.</p>';
      detailsNode.innerHTML = `
        <dl class="audit-detail-list">
          <div><dt>Event ID</dt><dd>${escapeHtml(event.id)}</dd></div>
          <div><dt>Date and time</dt><dd>${escapeHtml(formatDate(event.created_at))}</dd></div>
          <div><dt>Administrator</dt><dd>${escapeHtml(event.actor_name)} (${escapeHtml(event.actor_email)})</dd></div>
          <div><dt>Action</dt><dd>${escapeHtml(actionLabels[event.action] || event.action)}</dd></div>
          <div><dt>Resource</dt><dd>${escapeHtml(event.entity_label)} (${escapeHtml(event.entity_type)}${event.entity_id ? ` · ${escapeHtml(event.entity_id)}` : ''})</dd></div>
          <div><dt>Result</dt><dd>${escapeHtml(event.status)}</dd></div>
          <div><dt>Description</dt><dd>${escapeHtml(event.description)}</dd></div>
        </dl>${changes}`;
      dialog?.showModal();
    }

    function renderEvents() {
      if (!events.length) {
        activityList.innerHTML = isActivityPage
          ? '<tr><td colspan="7">No audit events match these filters.</td></tr>'
          : '<li>No administrative activity recorded in the last 30 days.</li>';
      } else if (isActivityPage) {
        activityList.innerHTML = events.map((event, index) => `
          <tr>
            <td>${escapeHtml(formatDate(event.created_at))}</td>
            <td>${escapeHtml(event.actor_name)}<br><small>${escapeHtml(event.actor_email)}</small></td>
            <td>${escapeHtml(actionLabels[event.action] || event.action)}</td>
            <td>${escapeHtml(event.entity_label)}<br><small>${escapeHtml(event.entity_type)}</small></td>
            <td>${escapeHtml(event.description)}</td>
            <td><span class="status-pill audit-result-${escapeHtml(event.status)}">${escapeHtml(event.status)}</span></td>
            <td><button class="btn btn-secondary btn-small" type="button" data-audit-detail="${index}">View</button></td>
          </tr>
        `).join('');
        activityList.querySelectorAll('[data-audit-detail]').forEach((button) => {
          button.addEventListener('click', () => renderDetails(events[Number(button.dataset.auditDetail)]));
        });
      } else {
        activityList.innerHTML = events.map((event) => `
          <li><strong>${escapeHtml(actionLabels[event.action] || event.action)}</strong> — ${escapeHtml(event.description)}
            <small>${escapeHtml(event.actor_name)} · ${escapeHtml(formatDate(event.created_at))}</small></li>
        `).join('');
      }
    }

    async function loadActors() {
      const actorSelect = controls.actor;
      if (!actorSelect) return;
      const response = await window.SkillBridgeAPI.requestJson('admin/audit-logs/actors', {
        baseUrl: apiBase,
        headers: { Authorization: 'Bearer ' + getAuthToken() }
      });
      if (!Array.isArray(response.actors)) throw new Error('The audit administrator response is invalid.');
      const selected = actorSelect.value;
      actorSelect.innerHTML = '<option value="">All administrators</option>' + response.actors.map((actor) => (
        `<option value="${escapeHtml(actor.actor_user_id)}">${escapeHtml(actor.actor_name)} (${escapeHtml(actor.actor_email)})</option>`
      )).join('');
      actorSelect.value = selected;
    }

    async function loadEvents({ silent = false } = {}) {
      if (loading) return;
      loading = true;
      if (!silent) activityList.innerHTML = isActivityPage
        ? '<tr><td colspan="7">Loading audit history…</td></tr>'
        : '<li>Loading recent activity…</li>';
      try {
        const params = new URLSearchParams({ page: String(currentPage), limit: String(pageSize) });
        if (isActivityPage) {
          Object.entries(controls).forEach(([key, control]) => {
            if (control?.value) params.set(key, control.value);
          });
        } else {
          params.set('range', '30d');
        }
        const response = await window.SkillBridgeAPI.requestJson(`admin/audit-logs?${params}`, {
          baseUrl: apiBase,
          headers: { Authorization: 'Bearer ' + getAuthToken() }
        });
        if (!Array.isArray(response.items) || !response.pagination) {
          throw new Error('The audit history response is invalid.');
        }
        events = response.items;
        renderEvents();
        const chartActivity = document.querySelector('[data-chart-activity]');
        if (chartActivity) chartActivity.textContent = String(response.pagination.total);
        if (totalNode) totalNode.textContent = `${response.pagination.total} matching events`;
        if (pageInfo) {
          const { total, page: resultPage, limit, totalPages } = response.pagination;
          pageInfo.textContent = total
            ? `Showing ${(resultPage - 1) * limit + 1}–${Math.min(resultPage * limit, total)} of ${total} events · page ${resultPage} of ${Math.max(totalPages, 1)}`
            : 'No matching events';
        }
        if (previousButton) previousButton.disabled = currentPage <= 1;
        if (nextButton) nextButton.disabled = currentPage >= (response.pagination.totalPages || 1);
        if (message) message.hidden = true;
      } catch (error) {
        if (!silent) activityList.innerHTML = isActivityPage
          ? '<tr><td colspan="7">Unable to load audit history.</td></tr>'
          : '<li>Unable to load audit history.</li>';
        if (message) {
          message.textContent = error.message || 'Unable to load audit history.';
          message.hidden = false;
        }
      } finally {
        loading = false;
      }
    }

    if (isActivityPage) {
      const customDateControls = document.querySelectorAll('[data-audit-custom]');
      controls.range.addEventListener('change', () => {
        customDateControls.forEach((element) => { element.hidden = controls.range.value !== 'custom'; });
        currentPage = 1;
        loadEvents();
      });
      [controls.from, controls.to, controls.actor, controls.action, controls.entity_type, controls.status].forEach((control) => {
        control?.addEventListener('change', () => {
          currentPage = 1;
          loadEvents();
        });
      });
      controls.q?.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          currentPage = 1;
          loadEvents();
        }, 300);
      });
      document.querySelector('[data-audit-clear]')?.addEventListener('click', () => {
        Object.values(controls).forEach((control) => {
          if (control) control.value = '';
        });
        controls.range.value = '30d';
        customDateControls.forEach((element) => { element.hidden = true; });
        currentPage = 1;
        loadEvents();
      });
      document.querySelector('[data-audit-refresh]')?.addEventListener('click', () => loadEvents());
      document.querySelector('[data-audit-close]')?.addEventListener('click', () => dialog?.close());
      previousButton?.addEventListener('click', () => {
        currentPage = Math.max(1, currentPage - 1);
        loadEvents();
      });
      nextButton?.addEventListener('click', () => {
        currentPage += 1;
        loadEvents();
      });
      loadActors().catch((error) => {
        if (message) {
          message.textContent = error.message || 'Unable to load audit administrators.';
          message.hidden = false;
        }
      });
    }

    await loadEvents();
    window.setInterval(() => loadEvents({ silent: true }), 15000);
  }

  async function initializeAdminTable(tableSelector, endpoint, rowRenderer) {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();
    try {
      const response = await window.SkillBridgeAPI.requestJson(endpoint, {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });

      const rows = response.items || response.users || [];
      if (!rows.length) {
        table.innerHTML = '<tr><td colspan="5">No records available.</td></tr>';
        return;
      }

      table.innerHTML = rows.map(rowRenderer).join('');
    } catch (error) {
      table.innerHTML = '<tr><td colspan="5">Unable to load records.</td></tr>';
    }
  }

  async function initializeAdminOpportunities() {
    const tbody = document.querySelector('[data-admin-opportunities]');
    if (!tbody) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();

    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/opportunities', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });

      const items = Array.isArray(response.items) ? response.items : [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6">No opportunities available.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map((item) => `
        <tr>
          <td>${(item.title || 'Untitled').replace(/</g, '&lt;')}</td>
          <td>${(item.organisation || 'N/A').replace(/</g, '&lt;')}</td>
          <td><span class="status-pill">${item.status || 'draft'}</span></td>
          <td>${item.verification_status || item.verificationStatus || 'pending'}</td>
          <td>${item.closing_date || item.closingDate || '—'}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-secondary btn-small" type="button" data-opportunity-edit="${String(item.id || '').replace(/"/g, '&quot;')}">Edit</button>
              <button class="btn btn-danger btn-small" type="button" data-opportunity-delete="${String(item.id || '').replace(/"/g, '&quot;')}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-opportunity-edit]').forEach((button) => {
        button.addEventListener('click', async () => {
          const form = document.getElementById('admin-opportunity-form');
          const message = document.getElementById('admin-opportunity-message');
          const id = button.dataset.opportunityEdit;
          if (!id || !form) return;

          try {
            const response = await window.SkillBridgeAPI.requestJson(`admin/opportunities/${encodeURIComponent(id)}`, {
              baseUrl: apiBase,
              headers: { Authorization: `Bearer ${token}` }
            });

            const item = response.opportunity || response.item;
            if (!item) throw new Error('Opportunity not found.');

            document.getElementById('opportunity-id').value = item.id || '';
            document.getElementById('opportunity-title').value = item.title || '';
            document.getElementById('opportunity-organisation').value = item.organisation || '';
            document.getElementById('opportunity-category').value = item.category || '';
            document.getElementById('opportunity-location').value = item.location || '';
            document.getElementById('opportunity-experience').value = item.experience_level || item.experienceLevel || 'Varies';
            document.getElementById('opportunity-closing-date').value = item.closing_date || item.closingDate || '';
            document.getElementById('opportunity-description').value = item.description || '';
            document.getElementById('opportunity-application').value = item.application_instructions || item.applicationInstructions || '';
            document.getElementById('opportunity-url').value = item.official_application_url || item.officialApplicationUrl || '';
            document.getElementById('opportunity-source').value = item.source_name || item.sourceName || '';
            document.getElementById('opportunity-status').value = item.status || 'draft';
            document.getElementById('opportunity-verified').checked = Boolean(item.is_verified ?? item.isVerified ?? true);
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) submitButton.textContent = 'Save changes';
            if (message) {
              message.textContent = `Editing ${item.title || 'opportunity'}.`;
              message.dataset.kind = 'success';
            }
            window.scrollTo({ top: form.offsetTop - 20, behavior: 'smooth' });
          } catch (error) {
            if (message) {
              message.textContent = error.message || 'Unable to load the opportunity.';
              message.dataset.kind = 'error';
            }
          }
        });
      });

      tbody.querySelectorAll('[data-opportunity-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.dataset.opportunityDelete;
          if (!id) return;

          const confirmed = window.confirm('Delete this opportunity? This action cannot be undone.');
          if (!confirmed) return;

          const message = document.getElementById('admin-opportunity-message');
          try {
            await window.SkillBridgeAPI.requestJson(`admin/opportunities/${encodeURIComponent(id)}`, {
              baseUrl: apiBase,
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` }
            });
            if (message) {
              message.textContent = 'Opportunity deleted successfully.';
              message.dataset.kind = 'success';
            }
            await initializeAdminOpportunities();
          } catch (error) {
            if (message) {
              message.textContent = error.message || 'Unable to delete the opportunity.';
              message.dataset.kind = 'error';
            }
          }
        });
      });
    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="6">Unable to load opportunities.</td></tr>';
    }
  }

  async function updateUserRole(userId, role) {
    const token = getAuthToken();
    const response = await window.SkillBridgeAPI.requestJson(`admin/users/${encodeURIComponent(String(userId))}/role`, {
      baseUrl: apiBase,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role })
    });

    return response.user;
  }

  async function initializeAdminUsers() {
    const tbody = document.querySelector('[data-admin-users]');
    if (!tbody) return;
    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const dialog = document.querySelector('[data-user-dialog]');
    const form = document.querySelector('[data-user-form]');
    const tableMessage = document.querySelector('[data-user-message]');
    const dialogMessage = document.querySelector('[data-user-dialog-message]');
    const nameInput = document.getElementById('managed-user-name');
    const emailInput = document.getElementById('managed-user-email');
    const roleInput = document.getElementById('managed-user-role');
    const statusInput = document.getElementById('managed-user-status');
    const searchInput = document.getElementById('user-search');
    const roleFilter = document.getElementById('user-role-filter');
    const statusFilter = document.getElementById('user-status-filter');
    const sortSelect = document.getElementById('user-sort');
    const pageInfo = document.querySelector('[data-user-page-info]');
    const previousButton = document.querySelector('[data-user-page-prev]');
    const nextButton = document.querySelector('[data-user-page-next]');
    const pageSize = 25;
    let users = [];
    let currentPage = 1;
    let editingUserId = null;
    let editingUserStatus = 'active';
    const requestHeaders = (extra = {}) => ({
      Authorization: ['Bearer', getAuthToken()].join(' '),
      ...extra
    });

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    function showMessage(element, text, kind = 'success') {
      if (!element) return;
      element.hidden = false;
      element.textContent = text;
      element.dataset.kind = kind;
    }

    function hideDialog() {
      if (dialog?.open) dialog.close();
    }

    function renderUserTable() {
      const query = (searchInput?.value || '').trim().toLowerCase();
      const filtered = users.filter((user) => (
        (!query || `${user.full_name || ''} ${user.email || ''}`.toLowerCase().includes(query))
        && (!roleFilter?.value || roleFilter.value === 'all' || user.role === roleFilter.value)
        && (!statusFilter?.value || statusFilter.value === 'all' || user.status === statusFilter.value)
      ));

      const [sortKey, sortDirection] = (sortSelect?.value || 'created_desc').split('_');
      filtered.sort((left, right) => {
        let comparison;
        if (sortKey === 'created') {
          comparison = String(left.created_at || '').localeCompare(String(right.created_at || ''));
        } else if (sortKey === 'email') {
          comparison = String(left.email || '').localeCompare(String(right.email || ''));
        } else {
          comparison = String(left.full_name || '').localeCompare(String(right.full_name || ''));
        }
        return (sortDirection === 'desc' ? -comparison : comparison) || String(left.id).localeCompare(String(right.id));
      });

      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      currentPage = Math.min(currentPage, pageCount);
      const start = (currentPage - 1) * pageSize;
      const pageUsers = filtered.slice(start, start + pageSize);

      if (!pageUsers.length) {
        tbody.innerHTML = `<tr><td colspan="7">${users.length ? 'No users match these filters.' : 'No user records were found.'}</td></tr>`;
      } else {
        tbody.innerHTML = pageUsers.map((user) => {
          const userName = user.full_name || user.email || 'User';
          const userId = escapeHtml(user.id);
          const status = ['active', 'awaiting', 'inactive'].includes(user.status) ? user.status : 'active';
          const created = user.created_at ? new Date(user.created_at).toLocaleDateString() : '—';
          const updated = user.updated_at ? new Date(user.updated_at).toLocaleDateString() : '—';
          return `
            <tr>
              <td>${escapeHtml(userName)}</td>
              <td>${escapeHtml(user.email || '—')}</td>
              <td>${escapeHtml(user.role || 'candidate')}</td>
              <td><span class="status-pill user-status-${status}">${escapeHtml(status[0].toUpperCase() + status.slice(1))}</span></td>
              <td>${escapeHtml(created)}</td>
              <td>${escapeHtml(updated)}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-small" type="button" data-user-edit="${userId}">Edit</button>
                  <select data-user-status="${userId}" aria-label="Change status for ${escapeHtml(userName)}">
                    <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="awaiting" ${status === 'awaiting' ? 'selected' : ''}>Awaiting</option>
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                  </select>
                  <button class="btn btn-danger btn-small" type="button" data-user-delete="${userId}">Delete</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }

      if (pageInfo) {
        pageInfo.textContent = filtered.length
          ? `Showing ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} matching users`
          : 'Showing 0 matching users';
      }
      if (previousButton) previousButton.disabled = currentPage <= 1;
      if (nextButton) nextButton.disabled = currentPage >= pageCount;

      tbody.querySelectorAll('[data-user-edit]').forEach((button) => {
        button.addEventListener('click', () => openUserDialog(users.find((user) => user.id === button.dataset.userEdit)));
      });
      tbody.querySelectorAll('[data-user-status]').forEach((select) => {
        const oldStatus = select.value;
        select.addEventListener('change', async () => {
          const user = users.find((item) => item.id === select.dataset.userStatus);
          if (!user) return;
          if (select.value === 'inactive' && oldStatus !== 'inactive'
            && !window.confirm(`Disable ${user.full_name || user.email || 'this user'}? They will lose access to protected account features.`)) {
            select.value = oldStatus;
            return;
          }
          select.disabled = true;
          try {
            await updateUser(user.id, { status: select.value });
            await loadUsers(`Status updated for ${user.full_name || user.email || 'user'}.`);
          } catch (error) {
            select.value = oldStatus;
            showMessage(tableMessage, error.message || 'Unable to update the account status.', 'error');
          } finally {
            select.disabled = false;
          }
        });
      });
      tbody.querySelectorAll('[data-user-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const user = users.find((item) => item.id === button.dataset.userDelete);
          if (!user || !window.confirm(`Delete ${user.full_name || user.email || 'this user'} (${user.email || user.id})? This permanently removes their authentication account and cascades related profile and saved-opportunity records.`)) {
            return;
          }

          button.disabled = true;
          try {
            await window.SkillBridgeAPI.requestJson(`admin/users/${encodeURIComponent(user.id)}`, {
              baseUrl: apiBase,
              method: 'DELETE',
              headers: requestHeaders()
            });
            await loadUsers(`${user.full_name || user.email || 'User'} was deleted.`);
          } catch (error) {
            showMessage(tableMessage, error.message || 'Unable to delete the user.', 'error');
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    function openUserDialog(user = null) {
      editingUserId = user?.id || null;
      editingUserStatus = user?.status || 'active';
      form.reset();
      dialogMessage.hidden = true;
      document.querySelector('[data-user-dialog-title]').textContent = user ? 'Edit user' : 'Add user';
      document.querySelector('[data-user-submit]').textContent = user ? 'Save changes' : 'Send invitation';
      nameInput.value = user?.full_name || '';
      emailInput.value = user?.email || '';
      roleInput.value = user?.role || 'candidate';
      statusInput.value = user?.status || 'awaiting';
      emailInput.readOnly = false;
      dialog.showModal();
      nameInput.focus();
    }

    async function updateUser(userId, payload) {
      return window.SkillBridgeAPI.requestJson(`admin/users/${encodeURIComponent(userId)}`, {
        baseUrl: apiBase,
        method: 'PATCH',
        headers: requestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
    }

    async function loadUsers(successMessage) {
      tbody.innerHTML = '<tr><td colspan="7">Loading users…</td></tr>';
      try {
        const response = await window.SkillBridgeAPI.requestJson('admin/users', {
          baseUrl: apiBase,
          headers: requestHeaders()
        });
        if (!Array.isArray(response.users)) {
          throw new Error('The user API returned an invalid response.');
        }
        users = response.users;
        ['total', 'active', 'awaiting', 'inactive'].forEach((key) => {
          const counter = document.querySelector(`[data-user-count="${key}"]`);
          if (counter) counter.textContent = String(response.counts?.[key] ?? (key === 'total' ? users.length : users.filter((user) => user.status === key).length));
        });
        renderUserTable();
        if (successMessage) showMessage(tableMessage, successMessage);
        else if (tableMessage) tableMessage.hidden = true;
      } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7">Unable to load users.</td></tr>';
        showMessage(tableMessage, error.message || 'Unable to load users.', 'error');
      }
    }

    document.querySelector('[data-user-add]')?.addEventListener('click', () => openUserDialog());
    document.querySelector('[data-user-dialog-close]')?.addEventListener('click', hideDialog);
    document.querySelector('[data-user-dialog-cancel]')?.addEventListener('click', hideDialog);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        full_name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        role: roleInput.value,
        status: statusInput.value
      };
      if (editingUserId && payload.status === 'inactive' && editingUserStatus !== 'inactive'
        && !window.confirm(`Disable ${payload.full_name}? They will lose access to protected account features.`)) {
        return;
      }

      const submit = document.querySelector('[data-user-submit]');
      submit.disabled = true;
      try {
        const isEditing = Boolean(editingUserId);
        await window.SkillBridgeAPI.requestJson(
          isEditing ? `admin/users/${encodeURIComponent(editingUserId)}` : 'admin/users',
          {
            baseUrl: apiBase,
            method: isEditing ? 'PATCH' : 'POST',
            headers: requestHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          }
        );
        hideDialog();
        await loadUsers(isEditing ? `Updated ${payload.full_name}.` : `Invitation sent to ${payload.email}.`);
      } catch (error) {
        showMessage(dialogMessage, error.message || 'Unable to save the user.', 'error');
      } finally {
        submit.disabled = false;
      }
    });

    [searchInput, roleFilter, statusFilter, sortSelect].forEach((control) => {
      control?.addEventListener(control === searchInput ? 'input' : 'change', () => {
        currentPage = 1;
        renderUserTable();
      });
    });
    previousButton?.addEventListener('click', () => {
      currentPage -= 1;
      renderUserTable();
    });
    nextButton?.addEventListener('click', () => {
      currentPage += 1;
      renderUserTable();
    });

    await loadUsers();
  }

  async function initializeAdminSettings() {
    const form = document.getElementById('admin-settings-form');
    if (!form) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();
    const fullNameInput = document.getElementById('admin-full-name');
    const successMessage = document.getElementById('admin-settings-message');

    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/profile', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.user?.full_name) {
        fullNameInput.value = response.user.full_name;
      }
    } catch (error) {
      if (successMessage) {
        successMessage.textContent = error.message || 'Unable to load your profile.';
        successMessage.dataset.kind = 'error';
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fullName = (fullNameInput.value || '').trim();
      if (!fullName) {
        if (successMessage) {
          successMessage.textContent = 'Please enter your full name.';
          successMessage.dataset.kind = 'error';
        }
        return;
      }

      try {
        const response = await window.SkillBridgeAPI.requestJson('admin/profile', {
          baseUrl: apiBase,
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ full_name: fullName })
        });

        if (successMessage) {
          successMessage.textContent = `Profile updated for ${response.user?.full_name || fullName}.`;
          successMessage.dataset.kind = 'success';
        }
      } catch (error) {
        if (successMessage) {
          successMessage.textContent = error.message || 'Unable to update your profile.';
          successMessage.dataset.kind = 'error';
        }
      }
    });
  }

  async function initializeAdminOpportunityForm() {
    const form = document.getElementById('admin-opportunity-form');
    if (!form) return;

    const isAuthed = await ensureAdminAuthed();
    if (!isAuthed) return;

    const token = getAuthToken();
    const message = document.getElementById('admin-opportunity-message');
    const submitButton = form.querySelector('button[type="submit"]');

    function resetOpportunityForm() {
      form.reset();
      const hiddenId = document.getElementById('opportunity-id');
      if (hiddenId) hiddenId.value = '';
      if (submitButton) submitButton.textContent = 'Create opportunity';
      document.getElementById('opportunity-verified').checked = true;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        id: document.getElementById('opportunity-id')?.value || undefined,
        title: document.getElementById('opportunity-title').value.trim(),
        organisation: document.getElementById('opportunity-organisation').value.trim(),
        category: document.getElementById('opportunity-category').value.trim(),
        location: document.getElementById('opportunity-location').value.trim(),
        closing_date: document.getElementById('opportunity-closing-date').value || null,
        experience_level: document.getElementById('opportunity-experience').value.trim() || 'Varies',
        description: document.getElementById('opportunity-description').value.trim(),
        application_instructions: document.getElementById('opportunity-application').value.trim(),
        official_application_url: document.getElementById('opportunity-url').value.trim(),
        source_name: document.getElementById('opportunity-source').value.trim(),
        status: document.getElementById('opportunity-status').value || 'draft',
        is_verified: document.getElementById('opportunity-verified').checked,
        verification_status: document.getElementById('opportunity-verified').checked ? 'verified' : 'pending',
        is_sample: false,
        eligibility: [],
        required_documents: []
      };

      if (!payload.title || !payload.organisation || !payload.category || !payload.location) {
        if (message) {
          message.textContent = 'Please fill in title, organisation, category, and location.';
          message.dataset.kind = 'error';
        }
        return;
      }

      try {
        const endpoint = payload.id ? `admin/opportunities/${encodeURIComponent(payload.id)}` : 'admin/opportunities';
        const method = payload.id ? 'PATCH' : 'POST';
        const response = await window.SkillBridgeAPI.requestJson(endpoint, {
          baseUrl: apiBase,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (message) {
          message.textContent = payload.id
            ? `Opportunity updated: ${response.opportunity?.title || payload.title}.`
            : `Opportunity created: ${response.opportunity?.title || payload.title}.`;
          message.dataset.kind = 'success';
        }
        resetOpportunityForm();
        await initializeAdminOpportunities();
      } catch (error) {
        if (message) {
          message.textContent = error.message || 'Unable to save the opportunity.';
          message.dataset.kind = 'error';
        }
      }
    });

    resetOpportunityForm();
  }

  function initializeLogout() {
    document.querySelectorAll('[data-admin-logout]').forEach((button) => {
      button.addEventListener('click', () => {
        setAuthToken('');
        window.location.assign('login.html');
      });
    });
  }

  function initializeThemeToggle() {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('skillbridge_theme', next); } catch {}
      });
    });
  }

  if (page === 'dashboard') {
    initializeAdminDashboard();
    initializeAdminActivity();
  }
  if (page === 'reports') {
    initializeAdminReports();
  }
  if (page === 'activity') {
    initializeAdminActivity();
  }
  if (page === 'opportunities') {
    initializeAdminOpportunities();
    initializeAdminOpportunityForm();
  }
  if (page === 'users') {
    initializeAdminUsers();
  }
  if (page === 'settings') {
    initializeAdminSettings();
  }

  initializeAdminLogin();
  initializeLogout();
  initializeThemeToggle();
})();
