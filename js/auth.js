(function () {
  let client = null;
  let session = null;
  let configError = null;

  const apiBase = window.SkillBridgeAPI?.getDefaultBaseUrl() || '/api';
  const ready = initialize().catch((error) => {
    configError = error;
    updateAuthChrome();
    return null;
  });

  async function initialize() {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/auth-config`, {
      headers: { Accept: 'application/json' }
    });
    const config = await response.json();
    if (!response.ok) {
      throw new Error(config?.error?.message || 'Account services are unavailable.');
    }
    if (!config.supabaseUrl || !config.publishableKey || !window.supabase?.createClient) {
      throw new Error('Supabase Auth is not configured for this site.');
    }

    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateAuthChrome();
      if (!session && getCurrentPageName() === 'profile') {
        window.location.replace('login.html?next=profile.html');
      }
    });
    updateAuthChrome();
    return client;
  }

  function getCurrentPageName() {
    return window.location.pathname.split('/').pop().replace(/\.html$/, '').toLowerCase();
  }

  function updateAuthChrome() {
    document.querySelectorAll('[data-auth-cta]').forEach((link) => {
      link.href = session ? 'profile.html' : 'register.html';
      link.textContent = session ? 'Dashboard' : 'Create Profile';
    });

    document.querySelectorAll('[data-auth-link]').forEach((link) => {
      link.href = session ? 'profile.html' : 'login.html';
      link.textContent = session ? 'Dashboard' : 'Log in';
    });
    document.querySelectorAll('[data-auth-logout]').forEach((button) => {
      button.hidden = !session;
    });
  }

  function setMessage(element, text, kind = 'error') {
    if (!element) return;
    element.textContent = text;
    element.dataset.kind = kind;
    element.hidden = !text;
  }

  function friendlyAuthError(error, context) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('already registered') || message.includes('already been registered')) {
      return 'An account with this email already exists. Try logging in instead.';
    }
    if (message.includes('email not confirmed') || message.includes('email is not confirmed')) {
      return 'Please verify your email using the link we sent before logging in.';
    }
    if (message.includes('invalid login credentials')) {
      return 'Email or password is incorrect.';
    }
    if (message.includes('password should be at least')) {
      return 'Choose a longer password and try again.';
    }
    if (message.includes('rate limit')) {
      return 'Too many attempts. Wait a few minutes and try again.';
    }
    if (context === 'profile') {
      return 'Your profile could not be loaded. Confirm the candidate profile migration has been applied.';
    }
    return error?.message || 'The request could not be completed. Please try again.';
  }

  async function requireClient() {
    await ready;
    if (!client) throw configError || new Error('Account services are unavailable.');
    return client;
  }

  async function loadSavedOpportunityIds() {
    if (!session) return [];
    const authClient = await requireClient();
    const { data, error } = await authClient
      .from('saved_opportunities')
      .select('opportunity_id')
      .eq('user_id', session.user.id);
    if (error) throw error;
    return (data || []).map((row) => String(row.opportunity_id));
  }

  async function setSavedOpportunity(id, shouldSave) {
    if (!session) throw new Error('Log in to manage saved opportunities.');
    const authClient = await requireClient();
    let query = authClient.from('saved_opportunities');
    if (shouldSave) {
      const { error } = await query.insert({
        user_id: session.user.id,
        opportunity_id: String(id)
      });
      if (error && error.code !== '23505') throw error;
      return;
    }

    const { error } = await query
      .delete()
      .eq('user_id', session.user.id)
      .eq('opportunity_id', String(id));
    if (error) throw error;
  }

  function displayFormError(form, message, kind = 'error') {
    setMessage(form.querySelector('[data-auth-message]'), message, kind);
  }

  function setFormBusy(form, busy, buttonText) {
    const button = form.querySelector('[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = buttonText;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function initRegistration() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      displayFormError(form, '');
      if (!form.reportValidity()) return;

      const fullName = form.elements.fullName.value.trim();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      const confirmation = form.elements.confirmPassword.value;
      if (!fullName) return displayFormError(form, 'Enter your full name.');
      if (password !== confirmation) return displayFormError(form, 'Passwords do not match.');

      setFormBusy(form, true, 'Creating account...');
      try {
        const authClient = await requireClient();
        const { data, error } = await authClient.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });
        if (error) throw error;

        if (data.user?.identities?.length === 0) {
          return displayFormError(form, 'An account with this email already exists. Try logging in instead.');
        }

        if (data.session) {
          window.location.assign('profile.html');
        } else {
          displayFormError(form, 'Account created. Check your email for the verification link before logging in.', 'success');
          form.reset();
        }
      } catch (error) {
        displayFormError(form, friendlyAuthError(error, 'register'));
      } finally {
        setFormBusy(form, false);
      }
    });
  }

  function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      displayFormError(form, '');
      if (!form.reportValidity()) return;

      setFormBusy(form, true, 'Signing in...');
      try {
        const authClient = await requireClient();
        const { error } = await authClient.auth.signInWithPassword({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value
        });
        if (error) throw error;
        const next = new URLSearchParams(window.location.search).get('next');
        displayFormError(form, 'Signed in. Opening your profile...', 'success');
        window.setTimeout(() => {
          window.location.assign(next === 'profile.html' ? next : 'profile.html');
        }, 350);
      } catch (error) {
        displayFormError(form, friendlyAuthError(error, 'login'));
      } finally {
        setFormBusy(form, false);
      }
    });
  }

  async function initProfile() {
    const form = document.getElementById('profile-form');
    if (!form) return;

    const authClient = await requireClient();
    if (!session) {
      window.location.replace('login.html?next=profile.html');
      return;
    }

    const dashboard = document.querySelector('.candidate-dashboard');
    const savedContainer = document.getElementById('saved-opportunities');
    const recentContainer = document.getElementById('recent-opportunities');
    const newContainer = document.getElementById('new-opportunities');
    const feedback = document.querySelector('[data-dashboard-feedback]');
    const retryOpportunities = document.querySelector('[data-retry-opportunities]');
    const saveButton = form.querySelector('[data-profile-save]');
    const cancelButton = form.querySelector('[data-profile-cancel]');
    const nameInput = form.elements.fullName;
    let savedIds = [];
    let originalName = '';

    form.elements.email.value = session.user.email || '';

    function updateCandidateIdentity(fullName) {
      const name = fullName || 'Candidate';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const initials = parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'C';
      document.querySelectorAll('[data-candidate-name], [data-welcome-name]').forEach((element) => {
        element.textContent = name;
      });
      document.querySelectorAll('[data-candidate-avatar]').forEach((element) => {
        element.textContent = initials;
      });
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      document.querySelectorAll('[data-greeting]').forEach((element) => {
        element.textContent = greeting;
      });
    }

    function updateCompletion() {
      const fields = [nameInput.value.trim(), form.elements.email.value.trim()];
      const completion = Math.round((fields.filter(Boolean).length / fields.length) * 100);
      document.querySelector('[data-profile-completion]').textContent = `${completion}%`;
      const progress = document.querySelector('[data-profile-progress]');
      progress.setAttribute('aria-valuenow', String(completion));
      progress.querySelector('span').style.width = `${completion}%`;
    }

    function updateProfileDirtyState() {
      const hasChanges = nameInput.value.trim() !== originalName;
      document.querySelector('[data-profile-state]').textContent = hasChanges ? 'Unsaved changes' : 'All changes saved';
      saveButton.disabled = !hasChanges;
      cancelButton.disabled = !hasChanges;
      updateCompletion();
    }

    function setDashboardFeedback(text, kind = 'success') {
      feedback.textContent = text;
      feedback.dataset.kind = kind;
      feedback.hidden = !text;
    }

    function formatOpportunityDate(value) {
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    }

    function getSafeOfficialUrl(value) {
      if (!value) return '';
      try {
        const url = new URL(value, window.location.href);
        return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    }

    function appendOpportunityCard(container, opportunity, options = {}) {
      const card = document.createElement('article');
      card.className = 'candidate-opportunity-card';

      const expired = opportunity.closingDate
        && new Date(`${opportunity.closingDate}T23:59:59`) < new Date();
      const status = document.createElement('span');
      status.className = `candidate-opportunity-status${expired ? ' is-expired' : ''}`;
      status.textContent = expired ? 'Expired' : 'Open';

      const title = document.createElement('a');
      title.className = 'candidate-opportunity-title';
      title.href = `opportunity-details.html?id=${encodeURIComponent(opportunity.id)}`;
      title.textContent = opportunity.title || 'Opportunity';

      const organisation = document.createElement('p');
      organisation.className = 'candidate-opportunity-organisation';
      organisation.textContent = opportunity.organisation || 'Organisation not listed';

      const metadata = document.createElement('div');
      metadata.className = 'candidate-opportunity-meta';
      [opportunity.category, opportunity.location, opportunity.closingDate
        ? `Closes ${formatOpportunityDate(opportunity.closingDate)}`
        : 'No closing date listed'].filter(Boolean).forEach((value) => {
        const item = document.createElement('span');
        item.textContent = value;
        metadata.appendChild(item);
      });

      const actions = document.createElement('div');
      actions.className = 'candidate-opportunity-actions';
      const details = document.createElement('a');
      details.className = 'candidate-text-link';
      details.href = title.href;
      details.textContent = 'View details';
      actions.appendChild(details);

      const officialUrl = getSafeOfficialUrl(opportunity.officialApplicationUrl || opportunity.sourceUrl);
      if (officialUrl) {
        const applyLink = document.createElement('a');
        applyLink.className = 'candidate-text-link';
        applyLink.href = officialUrl;
        applyLink.textContent = 'Official source';
        if (!officialUrl.startsWith('mailto:')) {
          applyLink.target = '_blank';
          applyLink.rel = 'noopener noreferrer';
        }
        actions.appendChild(applyLink);
      }

      if (options.saved) {
        const removeButton = document.createElement('button');
        removeButton.className = 'candidate-remove-button';
        removeButton.type = 'button';
        removeButton.dataset.dashboardRemove = opportunity.id;
        removeButton.textContent = 'Remove';
        removeButton.setAttribute('aria-label', `Remove ${opportunity.title || 'opportunity'} from saved opportunities`);
        actions.appendChild(removeButton);
      } else {
        const saved = savedIds.includes(String(opportunity.id));
        const saveControl = document.createElement('button');
        saveControl.className = 'candidate-save-button';
        saveControl.type = 'button';
        saveControl.dataset.dashboardSave = opportunity.id;
        saveControl.dataset.opportunityTitle = opportunity.title || 'opportunity';
        saveControl.dataset.saved = String(saved);
        saveControl.setAttribute('aria-pressed', String(saved));
        saveControl.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${opportunity.title || 'opportunity'}${saved ? ' from saved opportunities' : ''}`);
        saveControl.textContent = saved ? 'Saved' : 'Save';
        actions.appendChild(saveControl);
      }

      card.append(status, title, organisation, metadata, actions);
      container.appendChild(card);
    }

    function renderUnavailableSavedItem(container, id) {
      const item = document.createElement('article');
      item.className = 'candidate-opportunity-card candidate-opportunity-unavailable';
      const title = document.createElement('h3');
      title.textContent = 'This opportunity is no longer listed';
      const description = document.createElement('p');
      description.textContent = 'It may have closed or been removed from the public listings.';
      const removeButton = document.createElement('button');
      removeButton.className = 'candidate-remove-button';
      removeButton.type = 'button';
      removeButton.dataset.dashboardRemove = id;
      removeButton.textContent = 'Remove saved item';
      item.append(title, description, removeButton);
      container.appendChild(item);
    }

    function createDashboardLoadingRow() {
      const row = document.createElement('div');
      row.className = 'candidate-loading-row';
      row.setAttribute('aria-hidden', 'true');
      row.innerHTML = '<span></span><span></span>';
      return row;
    }

    function appendDashboardError(container, message, canRetry = false) {
      const error = document.createElement('div');
      error.className = 'candidate-empty-state candidate-error-state';
      const text = document.createElement('p');
      text.textContent = message;
      error.appendChild(text);
      if (canRetry) {
        const retry = document.createElement('button');
        retry.className = 'btn btn-outline';
        retry.type = 'button';
        retry.dataset.retrySaved = '';
        retry.textContent = 'Try loading again';
        error.appendChild(retry);
      }
      container.appendChild(error);
    }

    async function refreshSavedItems() {
      savedContainer.setAttribute('aria-busy', 'true');
      savedContainer.replaceChildren(createDashboardLoadingRow());
      try {
        savedIds = await loadSavedOpportunityIds();
        document.querySelector('[data-saved-count]').textContent = String(savedIds.length);
        document.querySelector('[data-saved-nav-count]').textContent = String(savedIds.length);
        savedContainer.replaceChildren();
        if (!savedIds.length) {
          const empty = document.createElement('div');
          empty.className = 'candidate-empty-state';
          const title = document.createElement('h3');
          title.textContent = 'Your shortlist starts here';
          const description = document.createElement('p');
          description.textContent = 'Save a verified opportunity to keep it close while you compare your options.';
          const browse = document.createElement('a');
          browse.className = 'btn btn-secondary';
          browse.href = 'opportunities.html';
          browse.textContent = 'Browse opportunities';
          empty.append(title, description, browse);
          savedContainer.appendChild(empty);
          return;
        }

        const opportunities = await Promise.all(savedIds.map(async (id) => {
          try {
            return await window.SkillBridgeAPI.getOpportunityById(id, { baseUrl: window.SkillBridgeAPI.getDefaultBaseUrl() });
          } catch {
            return null;
          }
        }));
        opportunities.forEach((opportunity, index) => {
          if (opportunity) appendOpportunityCard(savedContainer, opportunity, { saved: true });
          else renderUnavailableSavedItem(savedContainer, savedIds[index]);
        });
      } catch (error) {
        savedContainer.replaceChildren();
        appendDashboardError(savedContainer, 'Saved opportunities could not be loaded.', true);
        setDashboardFeedback('Your saved list could not be loaded. Try again, or confirm the saved-opportunities migration is applied.', 'error');
      } finally {
        savedContainer.setAttribute('aria-busy', 'false');
      }
    }

    async function refreshNewOpportunities() {
      newContainer.setAttribute('aria-busy', 'true');
      retryOpportunities.hidden = true;
      newContainer.replaceChildren(createDashboardLoadingRow());
      try {
        const result = await window.SkillBridgeAPI.listOpportunities({ sort: 'newest', limit: 6 }, {
          baseUrl: window.SkillBridgeAPI.getDefaultBaseUrl()
        });
        newContainer.replaceChildren();
        document.querySelector('[data-live-opportunity-count]').textContent = String(result.pagination.total);
        if (!result.items.length) {
          const empty = document.createElement('p');
          empty.className = 'candidate-empty-state';
          empty.textContent = 'There are no current verified listings to show right now. Check back soon.';
          newContainer.appendChild(empty);
        } else {
          result.items.forEach((opportunity) => appendOpportunityCard(newContainer, opportunity));
        }
      } catch {
        newContainer.replaceChildren();
        appendDashboardError(newContainer, 'New opportunities could not be loaded. Check your connection and try again.');
        retryOpportunities.hidden = false;
        document.querySelector('[data-live-opportunity-count]').textContent = '--';
      } finally {
        newContainer.setAttribute('aria-busy', 'false');
      }
    }

    async function refreshRecentlyViewed() {
      recentContainer.setAttribute('aria-busy', 'true');
      recentContainer.replaceChildren(createDashboardLoadingRow());
      try {
        let recentIds = [];
        try {
          const stored = JSON.parse(localStorage.getItem('skillbridge_recent') || '[]');
          if (Array.isArray(stored)) recentIds = [...new Set(stored.filter((id) => typeof id === 'string' || typeof id === 'number').map(String))];
        } catch {
          recentIds = [];
        }
        recentIds = recentIds.slice(0, 4);
        document.querySelector('[data-recent-count]').textContent = String(recentIds.length);
        recentContainer.replaceChildren();
        if (!recentIds.length) {
          const empty = document.createElement('p');
          empty.className = 'candidate-empty-state';
          empty.textContent = 'Recently opened opportunities will appear here on this device.';
          recentContainer.appendChild(empty);
          return;
        }
        const opportunities = await Promise.all(recentIds.map(async (id) => {
          try {
            return await window.SkillBridgeAPI.getOpportunityById(id, { baseUrl: window.SkillBridgeAPI.getDefaultBaseUrl() });
          } catch {
            return null;
          }
        }));
        opportunities.forEach((opportunity) => {
          if (opportunity) appendOpportunityCard(recentContainer, opportunity, { recentlyViewed: true });
        });
        if (!recentContainer.childElementCount) {
          const empty = document.createElement('p');
          empty.className = 'candidate-empty-state';
          empty.textContent = 'Those opportunities are no longer available in the public listings.';
          recentContainer.appendChild(empty);
        }
      } catch {
        recentContainer.replaceChildren();
        appendDashboardError(recentContainer, 'Recently viewed opportunities could not be loaded.');
      } finally {
        recentContainer.setAttribute('aria-busy', 'false');
      }
    }

    async function loadProfile() {
      try {
        const { data: profile, error } = await authClient
          .from('profiles')
          .select('full_name')
          .eq('id', session.user.id)
          .single();
        if (error) throw error;
        originalName = profile.full_name || '';
        nameInput.value = originalName;
        updateCandidateIdentity(originalName);
        updateProfileDirtyState();
      } catch (error) {
        displayFormError(form, friendlyAuthError(error, 'profile'));
      }
    }

    function updateNewOpportunitySaveControls() {
      newContainer.querySelectorAll('[data-dashboard-save]').forEach((button) => {
        const saved = savedIds.includes(String(button.dataset.dashboardSave));
        const title = button.dataset.opportunityTitle;
        button.dataset.saved = String(saved);
        button.setAttribute('aria-pressed', String(saved));
        button.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${title}${saved ? ' from saved opportunities' : ''}`);
        button.textContent = saved ? 'Saved' : 'Save';
      });
    }

    nameInput.addEventListener('input', () => {
      document.getElementById('profile-name-error').hidden = true;
      nameInput.removeAttribute('aria-invalid');
      displayFormError(form, '');
      updateProfileDirtyState();
    });

    cancelButton.addEventListener('click', () => {
      nameInput.value = originalName;
      document.getElementById('profile-name-error').hidden = true;
      nameInput.removeAttribute('aria-invalid');
      displayFormError(form, '');
      updateProfileDirtyState();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      displayFormError(form, '');
      const fullName = nameInput.value.trim();
      if (!form.reportValidity()) return;
      if (!fullName) {
        nameInput.setAttribute('aria-invalid', 'true');
        document.getElementById('profile-name-error').hidden = false;
        nameInput.focus();
        return;
      }
      setFormBusy(form, true, 'Saving...');
      try {
        const { error } = await authClient
          .from('profiles')
          .update({ full_name: fullName })
          .eq('id', session.user.id);
        if (error) throw error;
        originalName = fullName;
        nameInput.value = fullName;
        updateCandidateIdentity(fullName);
        updateProfileDirtyState();
        displayFormError(form, 'Your profile has been updated.', 'success');
      } catch (error) {
        displayFormError(form, friendlyAuthError(error, 'profile'));
      } finally {
        setFormBusy(form, false, 'Saving...');
        updateProfileDirtyState();
      }
    });

    dashboard.addEventListener('click', async (event) => {
      if (event.target.closest('[data-retry-saved]')) {
        await refreshSavedItems();
        return;
      }
      if (event.target.closest('[data-retry-opportunities]')) {
        await refreshNewOpportunities();
        return;
      }

      const removeButton = event.target.closest('[data-dashboard-remove]');
      const saveControl = event.target.closest('[data-dashboard-save]');
      const control = removeButton || saveControl;
      if (!control) return;
      const opportunityId = removeButton ? removeButton.dataset.dashboardRemove : saveControl.dataset.dashboardSave;
      const shouldSave = Boolean(saveControl) && saveControl.dataset.saved !== 'true';
      control.disabled = true;
      try {
        await setSavedOpportunity(opportunityId, shouldSave);
        setDashboardFeedback(shouldSave ? 'Opportunity saved to your shortlist.' : 'Opportunity removed from your shortlist.');
        await refreshSavedItems();
        updateNewOpportunitySaveControls();
      } catch (error) {
        control.disabled = false;
        setDashboardFeedback(error.message || 'The saved list could not be updated. Try again.', 'error');
      }
    });

    updateCandidateIdentity('Candidate');
    await Promise.all([loadProfile(), refreshSavedItems(), refreshRecentlyViewed(), refreshNewOpportunities()]);
  }

  document.addEventListener('click', async (event) => {
    const logoutButton = event.target.closest('[data-auth-logout]');
    if (!logoutButton) return;
    logoutButton.disabled = true;
    try {
      const authClient = await requireClient();
      const { error } = await authClient.auth.signOut();
      if (error) throw error;
      window.location.assign('index.html');
    } catch (error) {
      logoutButton.disabled = false;
      setMessage(document.querySelector('[data-auth-global-message]'), friendlyAuthError(error, 'logout'));
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    updateAuthChrome();
    const page = getCurrentPageName();
    if (page === 'register') initRegistration();
    if (page === 'login') initLogin();
    if (page === 'profile') {
      try {
        await ready;
        await initProfile();
      } catch (error) {
        setMessage(document.querySelector('[data-auth-message]'), friendlyAuthError(error, 'profile'));
      }
    }
  });

  window.SkillBridgeAuth = {
    ready,
    getClient: requireClient,
    getSession: () => session,
    loadSavedOpportunityIds,
    setSavedOpportunity,
    isConfigured: () => Boolean(client)
  };
})();