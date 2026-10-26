(function () {
  const page = document.body.dataset.adminPage;
  const apiBase = window.SkillBridgeAPI?.getDefaultBaseUrl() || '/api';

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

      if (error.message === 'You do not have permission to access the admin area.') {
        setAuthToken('');
        showAdminAccessError('This account no longer has admin access. Contact a Supabase project administrator.');
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
          if (authError.message === 'Failed to fetch') {
            throw new Error('Unable to reach Supabase Auth. Check your internet connection and Supabase project configuration.');
          }
          throw authError;
        }

        const { data, error } = signInResult;
        if (error || !data.session) {
          throw new Error(error?.message || 'Admin sign in failed.');
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
      const chartActivityNode = document.querySelector('[data-chart-activity]');

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
      if (chartActivityNode) chartActivityNode.textContent = String(metrics.awaitingReview ?? 0);

      if (activityList) {
        activityList.innerHTML = '<li>No admin activity recorded yet.</li>';
      }
    } catch (error) {
      if (metricsContainer) {
        metricsContainer.innerHTML = '<article class="admin-stat-card"><span>Error</span><strong>--</strong><small>Unable to load metrics.</small></article>';
      }
      if (activityList) {
        activityList.innerHTML = '<li>Unable to load activity right now.</li>';
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

    const token = getAuthToken();
    try {
      const response = await window.SkillBridgeAPI.requestJson('admin/reports', {
        baseUrl: apiBase,
        headers: { Authorization: `Bearer ${token}` }
      });
      const summary = response.summary || {};
      const categories = Array.isArray(response.categories) ? response.categories : [];
      activityList.innerHTML = [
        `<li><strong>${summary.totalUsers ?? 0}</strong> registered users</li>`,
        `<li><strong>${summary.totalOpportunities ?? 0}</strong> visible opportunities</li>`,
        `<li><strong>${summary.awaitingReview ?? 0}</strong> items awaiting review</li>`,
        `<li><strong>${categories.length}</strong> opportunity categories tracked</li>`,
        `<li>Last updated: ${new Date(response.generatedAt || Date.now()).toLocaleString()}</li>`
      ].join('');
    } catch (error) {
      activityList.innerHTML = '<li>Unable to load audit activity right now.</li>';
    }
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

  function initializeAdminUsers() {
    const tbody = document.querySelector('[data-admin-users]');
    if (!tbody) return;
    initializeAdminTable('[data-admin-users]', 'admin/users', (user) => `
      <tr>
        <td>${(user.full_name || user.email || 'User').replace(/</g, '&lt;')}</td>
        <td>${(user.email || '—').replace(/</g, '&lt;')}</td>
        <td>
          <select data-user-role-select data-user-id="${String(user.id || '').replace(/"/g, '&quot;')}" aria-label="Role for ${String(user.full_name || user.email || 'user').replace(/</g, '&lt;')}">
            <option value="candidate" ${user.role === 'candidate' ? 'selected' : ''}>Candidate</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super admin</option>
          </select>
        </td>
        <td><span class="status-pill">${user.status || 'active'}</span></td>
        <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
      </tr>
    `);

    tbody.querySelectorAll('[data-user-role-select]').forEach((select) => {
      const originalRole = select.value;
      select.addEventListener('change', async (event) => {
        const nextRole = event.target.value;
        const userId = event.target.dataset.userId;
        event.target.disabled = true;

        try {
          await updateUserRole(userId, nextRole);
          event.target.dataset.role = nextRole;
        } catch (error) {
          event.target.value = originalRole;
          const message = error.message || 'Unable to update the user role.';
          window.alert(message);
        } finally {
          event.target.disabled = false;
        }
      });
    });
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
