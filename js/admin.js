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
      document.querySelector('[data-metric="totalUsers"]').textContent = String(metrics.totalUsers ?? '--');
      document.querySelector('[data-metric="activeCandidates"]').textContent = String(metrics.activeCandidateAccounts ?? '--');
      document.querySelector('[data-metric="totalOpportunities"]').textContent = String(metrics.totalOpportunities ?? '--');
      document.querySelector('[data-metric="publishedOpportunities"]').textContent = String(metrics.publishedOpportunities ?? '--');
      document.querySelector('[data-metric="draftOpportunities"]').textContent = String(metrics.draftOpportunities ?? '--');
      document.querySelector('[data-metric="expiredOpportunities"]').textContent = String(metrics.expiredOpportunities ?? '--');
      document.querySelector('[data-metric="awaitingReview"]').textContent = String(metrics.awaitingReview ?? '--');
      document.querySelector('[data-last-updated]').textContent = new Date(response.generatedAt || Date.now()).toLocaleString();
      document.querySelector('[data-chart-users]').textContent = String(metrics.totalUsers ?? '--');
      document.querySelector('[data-chart-opportunities]').textContent = String(metrics.totalOpportunities ?? '--');
      document.querySelector('[data-chart-activity]').textContent = String(metrics.awaitingReview ?? '--');

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

  function initializeAdminOpportunities() {
    const tbody = document.querySelector('[data-admin-opportunities]');
    if (!tbody) return;
    initializeAdminTable('[data-admin-opportunities]', 'admin/opportunities', (item) => `
      <tr>
        <td>${(item.title || 'Untitled').replace(/</g, '&lt;')}</td>
        <td>${(item.organisation || 'N/A').replace(/</g, '&lt;')}</td>
        <td><span class="status-pill">${item.status || 'draft'}</span></td>
        <td>${item.verification_status || 'pending'}</td>
        <td>${item.closing_date || '—'}</td>
      </tr>
    `);
  }

  function initializeAdminUsers() {
    const tbody = document.querySelector('[data-admin-users]');
    if (!tbody) return;
    initializeAdminTable('[data-admin-users]', 'admin/users', (user) => `
      <tr>
        <td>${(user.full_name || user.email || 'User').replace(/</g, '&lt;')}</td>
        <td>${(user.email || '—').replace(/</g, '&lt;')}</td>
        <td>${user.role || 'candidate'}</td>
        <td><span class="status-pill">${user.status || 'active'}</span></td>
        <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
      </tr>
    `);
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
  if (page === 'opportunities') {
    initializeAdminOpportunities();
  }
  if (page === 'users') {
    initializeAdminUsers();
  }

  initializeAdminLogin();
  initializeLogout();
  initializeThemeToggle();
})();
