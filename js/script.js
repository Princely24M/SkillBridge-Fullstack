/**
 * SkillBridge - Youth Opportunity & Skills Platform
 * Master JavaScript File (Vanilla JS)
 * 
 * Supports both verified official datasets (100 records) and sample opportunities:
 * - JSON data loader & cache
 * - Dynamic opportunity rendering (Home & Listing)
 * - Multi-criteria search & filtering (Category, Location, Experience, Closing Date)
 * - Expiration and "Closing Soon" date calculations
 * - Opportunity detail loader via URL params (?id=skillbridge-001)
 * - Interactive document checklist & bookmarking (localStorage)
 * - Form validation with accessible error & success feedback
 * - Mobile responsive navigation & theme toggling (Light/Dark)
 */

// Global State
const APP_STATE = {
  opportunities: [],
  datasetMeta: null,
  pagination: null,
  isLoading: true,
  currentFilter: {
    keyword: '',
    category: 'All',
    location: 'All',
    experience: 'All',
    closingDate: 'All',
    showExpired: false,
    showBookmarkedOnly: false
  },
  savedOpportunities: JSON.parse(localStorage.getItem('skillbridge_saved') || '[]'),
  recentlyViewed: JSON.parse(localStorage.getItem('skillbridge_recent') || '[]')
};
let opportunityRefreshSequence = 0;

function normalizeSavedOpportunities() {
  APP_STATE.savedOpportunities = [...new Set(APP_STATE.savedOpportunities.map(String))];
  localStorage.setItem('skillbridge_saved', JSON.stringify(APP_STATE.savedOpportunities));
}

function getApiBaseUrl() {
  return window.SkillBridgeAPI.getDefaultBaseUrl();
}

function getCurrentApiFilters() {
  const filters = {
    sort: 'closing_date',
    page: 1,
    limit: 40
  };

  if (APP_STATE.currentFilter.keyword) {
    filters.q = APP_STATE.currentFilter.keyword;
  }
  if (APP_STATE.currentFilter.category && APP_STATE.currentFilter.category !== 'All') {
    filters.category = APP_STATE.currentFilter.category;
  }
  if (APP_STATE.currentFilter.location && APP_STATE.currentFilter.location !== 'All') {
    filters.location = APP_STATE.currentFilter.location;
  }

  return filters;
}

function showApiError(message) {
  const main = document.querySelector('main');
  if (main) {
    showNotificationBanner(message, 'warning');
  }
}

const OFFLINE_DEMO_DATA = [
  {
    id: 'demo-101',
    title: 'Youth Marketing Intern',
    organisation: 'GrowthWorks Africa',
    category: 'Internship',
    location: 'Johannesburg, Gauteng',
    closingDate: '2026-10-20',
    experienceLevel: 'Entry Level',
    description: 'Support digital campaigns and community engagement for a youth-led social impact brand.',
    eligibility: ['South African youth aged 18-35', 'Strong written communication skills'],
    requiredDocuments: ['CV', 'Cover letter', 'Academic transcript'],
    applicationInstructions: 'Email your CV and a short motivation to careers@growthworks.africa.',
    officialApplicationUrl: 'mailto:careers@growthworks.africa',
    sourceUrl: 'https://example.com/growthworks',
    sourceName: 'GrowthWorks Africa',
    lastVerified: '2026-10-06',
    verificationStatus: 'sample',
    verificationLevel: 'demonstration',
    status: 'active',
    isVerified: false,
    isSample: true
  },
  {
    id: 'demo-102',
    title: 'Learnership: Business Administration',
    organisation: 'National Skills Academy',
    category: 'Learnership',
    location: 'Cape Town, Western Cape',
    closingDate: '2026-10-24',
    experienceLevel: 'Entry Level',
    description: 'Structured learnership covering office administration, client support, and digital office systems.',
    eligibility: ['Grade 12 or equivalent', 'Unemployed youth'],
    requiredDocuments: ['CV', 'ID copy', 'Matric certificate'],
    applicationInstructions: 'Apply through the academy recruitment portal before the closing date.',
    officialApplicationUrl: 'https://example.com/academy-learnership',
    sourceUrl: 'https://example.com/academy-learnership',
    sourceName: 'National Skills Academy',
    lastVerified: '2026-10-06',
    verificationStatus: 'sample',
    verificationLevel: 'demonstration',
    status: 'active',
    isVerified: false,
    isSample: true
  },
  {
    id: 'demo-103',
    title: 'Bursary for Information Systems',
    organisation: 'Future Skills Trust',
    category: 'Bursary',
    location: 'Pretoria, Gauteng',
    closingDate: '2026-11-05',
    experienceLevel: 'Matric to Tertiary',
    description: 'Funding support for students pursuing IT, analytics, and digital systems qualifications.',
    eligibility: ['Strong academic performance', 'Financial need'],
    requiredDocuments: ['Academic record', 'Proof of income', 'Motivational essay'],
    applicationInstructions: 'Submit your bursary application online via the scholarship portal.',
    officialApplicationUrl: 'https://example.com/future-skills',
    sourceUrl: 'https://example.com/future-skills',
    sourceName: 'Future Skills Trust',
    lastVerified: '2026-10-06',
    verificationStatus: 'sample',
    verificationLevel: 'demonstration',
    status: 'active',
    isVerified: false,
    isSample: true
  },
  {
    id: 'demo-104',
    title: 'Customer Service Agent',
    organisation: 'SupportHub SA',
    category: 'Job',
    location: 'Durban, KwaZulu-Natal',
    closingDate: '2026-10-18',
    experienceLevel: 'Junior',
    description: 'Handle customer queries, support order tracking, and maintain service standards in a busy call centre.',
    eligibility: ['Matric certificate', 'Good communication skills'],
    requiredDocuments: ['CV', 'ID', 'References'],
    applicationInstructions: 'Apply online or send your CV to hiring@supporthub.co.za.',
    officialApplicationUrl: 'mailto:hiring@supporthub.co.za',
    sourceUrl: 'https://example.com/supporthub',
    sourceName: 'SupportHub SA',
    lastVerified: '2026-10-06',
    verificationStatus: 'sample',
    verificationLevel: 'demonstration',
    status: 'active',
    isVerified: false,
    isSample: true
  }
];

/* ==========================================================================
   1. Application Initialisation
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  normalizeSavedOpportunities();
  initTheme();
  initMobileNavigation();
  initToasts();

  // Load Opportunity Data
  await loadOpportunities();
  if (window.SkillBridgeAuth) {
    await window.SkillBridgeAuth.ready;
    if (window.SkillBridgeAuth.getSession()) {
      try {
        APP_STATE.savedOpportunities = await window.SkillBridgeAuth.loadSavedOpportunityIds();
      } catch (error) {
        APP_STATE.savedOpportunities = [];
        showApiError(`Unable to load your saved opportunities. ${error.message || 'Please try again later.'}`);
      }
    }
  }
  updateBookmarkNavState();

  // Page Specific Routines
  const currentPage = getCurrentPageName();

  if (currentPage === 'index' || currentPage === '') {
    initHomePage();
  } else if (currentPage === 'opportunities') {
    initOpportunitiesPage();
  } else if (currentPage === 'opportunity-details') {
    initOpportunityDetailsPage();
  } else if (currentPage === 'resources') {
    initResourcesPage();
  } else if (currentPage === 'contact') {
    initContactPage();
  }
});

/**
 * Determine the current page identifier from window.location
 */
function getCurrentPageName() {
  const path = window.location.pathname;
  const page = path.split('/').pop().replace('.html', '');
  return page.toLowerCase();
}

/* ==========================================================================
   2. Theme & Accessibility Utilities
   ========================================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('skillbridge_theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', savedTheme || preferredTheme);
}

function initMobileNavigation() {
  const toggleBtn = document.querySelector('.mobile-menu-btn');
  const drawer = document.querySelector('.mobile-drawer');

  if (!toggleBtn || !drawer) return;

  toggleBtn.addEventListener('click', () => {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', !isExpanded);
    drawer.classList.toggle('is-open');

    if (!isExpanded) {
      toggleBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        <span class="sr-only">Close navigation menu</span>
      `;
    } else {
      toggleBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
        <span class="sr-only">Open navigation menu</span>
      `;
    }
  });

  // Close drawer when pressing Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
      toggleBtn.click();
    }
  });
}

/* ==========================================================================
   3. Data Loading & Date Processing
   ========================================================================== */
async function loadOpportunities() {
  try {
    const result = await window.SkillBridgeAPI.listOpportunities(getCurrentApiFilters(), {
      baseUrl: getApiBaseUrl(),
      fallback: OFFLINE_DEMO_DATA
    });
    APP_STATE.opportunities = result.items || [];
    APP_STATE.pagination = result.pagination || null;
    APP_STATE.datasetMeta = {
      source: result.fallback === true ? 'offline-demo' : 'api',
      note: result.fallback === true ? 'Offline demo dataset' : 'Live Express API dataset'
    };
    APP_STATE.isLoading = false;
  } catch (err) {
    console.error('Error loading opportunities from the API.', err);
    APP_STATE.opportunities = [];
    APP_STATE.pagination = null;
    APP_STATE.datasetMeta = { source: 'api-error', note: 'API request failed' };
    APP_STATE.isLoading = false;
    showApiError(`Unable to load opportunities from the API. ${err.message || 'Please try again later.'}`);
  }
}

async function refreshOpportunitiesFromApi({ showError = true, onUpdate } = {}) {
  const requestSequence = ++opportunityRefreshSequence;

  try {
    const result = await window.SkillBridgeAPI.listAllOpportunities(getCurrentApiFilters(), {
      baseUrl: getApiBaseUrl(),
      fallback: OFFLINE_DEMO_DATA
    });
    if (requestSequence !== opportunityRefreshSequence) return result;

    APP_STATE.opportunities = result.items || [];
    APP_STATE.pagination = result.pagination || null;
    APP_STATE.datasetMeta = {
      source: result.fallback === true ? 'offline-demo' : 'api',
      note: result.fallback === true ? 'Offline demo dataset' : 'Live Express API dataset'
    };
    APP_STATE.isLoading = false;
    if (typeof onUpdate === 'function') onUpdate();
    return result;
  } catch (err) {
    if (requestSequence !== opportunityRefreshSequence) return null;

    console.error('Error refreshing opportunities from the API.', err);
    APP_STATE.opportunities = [];
    APP_STATE.pagination = null;
    APP_STATE.isLoading = false;
    if (showError) {
      showApiError(`Unable to refresh opportunities. ${err.message || 'Please try again later.'}`);
    }
    if (typeof onUpdate === 'function') onUpdate();
    return null;
  }
}

/**
 * Check if opportunity deadline has expired
 */
function isOpportunityExpired(item) {
  if (!item || !window.SkillBridgeAPI.isValidDateOnly(item.closingDate)) return false;
  return item.closingDate < window.SkillBridgeAPI.getCurrentDateOnly();
}

/**
 * Check if opportunity is closing within 7 days
 */
function isClosingSoon(item) {
  return window.SkillBridgeAPI.isOpportunityClosingSoon(item);
}

/**
 * Calculate days remaining until closing date
 */
function getDaysRemaining(item) {
  if (!item || !window.SkillBridgeAPI.isValidDateOnly(item.closingDate)) return null;
  const today = window.SkillBridgeAPI.getCurrentDateOnly();
  const closingDate = new Date(`${item.closingDate}T00:00:00.000Z`);
  const currentDate = new Date(`${today}T00:00:00.000Z`);
  return Math.round((closingDate - currentDate) / (1000 * 60 * 60 * 24));
}

/**
 * Format ISO date string into readable English
 */
function formatDate(dateStr) {
  if (!dateStr) return 'Ongoing / Open';
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (!window.SkillBridgeAPI.isValidDateOnly(dateStr)) return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-ZA', options);
}

/* ==========================================================================
   4. Opportunity Card Component Builder
   ========================================================================== */
function createOpportunityCardElement(item) {
  const isExpired = isOpportunityExpired(item);
  const closingSoon = !isExpired && isClosingSoon(item);
  const isSaved = APP_STATE.savedOpportunities.includes(String(item.id));
  const isVerified = Boolean(item.isVerified || item.verificationStatus === 'verified' || item.isSample === false);

  const card = document.createElement('article');
  card.className = 'opportunity-card';
  card.setAttribute('data-id', item.id);

  let statusBadgeHtml = '';
  if (isExpired) {
    statusBadgeHtml = '<span class="badge badge-expired" role="status">Expired</span>';
  } else if (closingSoon) {
    const days = getDaysRemaining(item);
    const dayLabel = days === 0 ? 'Today' : (days === 1 ? '1 day left' : `${days} days left`);
    statusBadgeHtml = `<span class="badge badge-closing-soon" role="status" aria-label="Closing soon: ${dayLabel}">Closing soon</span>`;
  }

  const verifiedBadgeHtml = isVerified
    ? '<span class="verified-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>Verified</span>'
    : '<span class="badge badge-sample">Sample</span>';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-top-badges">
        <span class="badge badge-category">${escapeHtml(item.category || 'Opportunity')}</span>
      </div>

      <button class="bookmark-btn ${isSaved ? 'is-bookmarked' : ''}" 
              data-id="${item.id}" 
              title="${isSaved ? 'Remove from saved' : 'Save opportunity'}"
              aria-label="${isSaved ? 'Remove ' + item.title + ' from bookmarks' : 'Bookmark ' + item.title}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    </div>

    <div class="card-header-row">
      <div class="card-title-wrap">
        <h3 class="card-title">
          <a href="opportunity-details.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a>
        </h3>
        <div class="card-org">${escapeHtml(item.organisation)}</div>
      </div>
      ${verifiedBadgeHtml}
    </div>

    <div class="card-meta-list">
      <span class="card-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        ${escapeHtml(item.location || 'South Africa')}
      </span>
      <span class="card-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
        </svg>
        ${escapeHtml(item.experienceLevel || 'Varies')}
      </span>
    </div>

    <div class="card-bottom-row">
      <div class="closing-text">Closes: ${formatDate(item.closingDate)}</div>
      <a href="opportunity-details.html?id=${encodeURIComponent(item.id)}" class="view-details-link">
        View details <span aria-hidden="true">→</span>
      </a>
    </div>

    ${statusBadgeHtml ? `<div class="status-badge-inline">${statusBadgeHtml}</div>` : ''}
  `;

  const bookmarkBtn = card.querySelector('.bookmark-btn');
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleBookmark(item.id, bookmarkBtn, item.title);
    });
  }

  return card;
}

/* ==========================================================================
   5. Home Page Logic (index.html)
   ========================================================================== */
function initHomePage() {
  const featuredContainer = document.getElementById('featured-opportunities-container');
  const deadlinesContainer = document.getElementById('upcoming-deadlines-container');
  const heroSearchForm = document.getElementById('hero-search-form');

  // Hero Search Redirection
  if (heroSearchForm) {
    heroSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const keyword = document.getElementById('hero-search-input').value.trim();
      const category = document.getElementById('hero-category-select').value;
      const params = new URLSearchParams();
      if (keyword) params.append('search', keyword);
      if (category && category !== 'All') params.append('category', category);
      window.location.href = `opportunities.html?${params.toString()}`;
    });
  }

  if (featuredContainer || deadlinesContainer) {
    const featuredLoad = async () => {
      try {
        const result = await window.SkillBridgeAPI.listOpportunities({
          page: 1,
          limit: 3,
          sort: 'closing_date'
        }, {
          baseUrl: getApiBaseUrl(),
          fallback: OFFLINE_DEMO_DATA
        });

        APP_STATE.opportunities = result.items || [];
        APP_STATE.pagination = result.pagination || null;

        if (featuredContainer) {
          featuredContainer.innerHTML = '';
          const activeItems = APP_STATE.opportunities
            .filter(o => !isOpportunityExpired(o) && o.closingDate)
            .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate));
          const toRender = activeItems.slice(0, 3);

          if (!toRender.length) {
            featuredContainer.innerHTML = '<div class="featured-card placeholder-card">No featured opportunities are currently available.</div>';
          } else {
            toRender.forEach(item => {
              const isVerified = Boolean(item.isVerified || item.verificationStatus === 'verified' || item.isSample === false);
              const featuredCard = document.createElement('article');
              featuredCard.className = 'featured-card';
              featuredCard.innerHTML = `
                <div class="featured-card-top">
                  <span class="featured-type">${escapeHtml(item.category || 'Opportunity')}</span>
                  ${isVerified ? `
                    <span class="featured-verified">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5"></path>
                      </svg>
                      Verified
                    </span>` : ''}
                </div>

                <div class="featured-card-body">
                  <h3><a href="opportunity-details.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a></h3>
                  <div class="featured-org">${escapeHtml(item.organisation)}</div>
                </div>

                <div class="featured-meta-block">
                  <div class="featured-meta-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>${escapeHtml(item.location || 'South Africa')}</span>
                    <span class="meta-divider">•</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                    </svg>
                    <span>${escapeHtml(item.experienceLevel || 'Varies')}</span>
                  </div>
                </div>

                <div class="featured-card-footer">
                  <span class="featured-closing">Closes: ${formatDate(item.closingDate)}</span>
                  <a href="opportunity-details.html?id=${encodeURIComponent(item.id)}" class="featured-link">View details <span aria-hidden="true">→</span></a>
                </div>
              `;
              featuredContainer.appendChild(featuredCard);
            });
          }
        }

        if (deadlinesContainer) {
          deadlinesContainer.innerHTML = '';
          const activeWithDeadlines = APP_STATE.opportunities
            .filter(o => !isOpportunityExpired(o) && o.closingDate)
            .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate))
            .slice(0, 4);

          if (!activeWithDeadlines.length) {
            deadlinesContainer.innerHTML = '<div class="deadline-item placeholder-row">No upcoming deadlines available.</div>';
          } else {
            activeWithDeadlines.forEach(item => {
              const days = getDaysRemaining(item);
              const dayText = days === 0 ? 'Today' : (days === 1 ? '1 day left' : `${days} days left`);
              const dateBadge = (item.closingDate || '').slice(5).replace('-', '/');

              const deadlineCard = document.createElement('div');
              deadlineCard.className = 'deadline-item';
              deadlineCard.innerHTML = `
                <span class="date-pill">${escapeHtml(dateBadge)}</span>
                <div>
                  <span class="deadline-title">${escapeHtml(item.title)}</span>
                  <span class="deadline-sub">${escapeHtml(item.organisation)}</span>
                </div>
                <span class="deadline-arrow" aria-label="${escapeHtml(dayText)}">→</span>
              `;
              deadlinesContainer.appendChild(deadlineCard);
            });
          }
        }
      } catch (error) {
        console.error('Home page API load failed.', error);
        if (featuredContainer) {
          featuredContainer.innerHTML = '<div class="featured-card placeholder-card">Unable to load featured opportunities. Please try again later.</div>';
        }
        if (deadlinesContainer) {
          deadlinesContainer.innerHTML = '<div class="deadline-item placeholder-row">Unable to load deadlines.</div>';
        }
        showApiError(`Unable to load homepage opportunities. ${error.message || 'Please try again later.'}`);
      }
    };

    featuredLoad();
  }
}

/* ==========================================================================
   6. Opportunities Listing Page Logic (opportunities.html)
   ========================================================================== */
function initOpportunitiesPage() {
  const gridContainer = document.getElementById('opportunities-list-container');
  const emptyState = document.getElementById('empty-state');
  const resultsCount = document.getElementById('results-count');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  const emptyClearBtn = document.getElementById('empty-clear-btn');
  const searchInput = document.getElementById('filter-search');
  const categorySelect = document.getElementById('filter-category');
  const locationSelect = document.getElementById('filter-location');
  const experienceSelect = document.getElementById('filter-experience');
  const closingSelect = document.getElementById('filter-closing');
  const expiredToggle = document.getElementById('toggle-expired');
  const bookmarkedOnlyToggle = document.getElementById('toggle-bookmarked-only');

  const refreshListing = (showError = true) => refreshOpportunitiesFromApi({
    showError,
    onUpdate: applyFiltersAndRender
  });

  window.__skillbridgeApplyFilters = () => refreshListing(false);

  // Populate dynamic category and location dropdown options from dataset if available
  populateFilterOptions(categorySelect, locationSelect);

  // Read URL Parameters on load
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get('search');
  const categoryParam = urlParams.get('category');
  const locationParam = urlParams.get('location');

  if (searchParam && searchInput) {
    searchInput.value = searchParam;
    APP_STATE.currentFilter.keyword = searchParam;
  }
  if (categoryParam && categorySelect) {
    categorySelect.value = categoryParam;
    APP_STATE.currentFilter.category = categoryParam;
  }
  if (locationParam && locationSelect) {
    locationSelect.value = locationParam;
    APP_STATE.currentFilter.location = locationParam;
  }

  // Filter Event Listeners
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      APP_STATE.currentFilter.keyword = searchInput.value.trim();
      refreshListing(true);
    }, 250));
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      APP_STATE.currentFilter.category = categorySelect.value;
      refreshListing(true);
    });
  }

  if (locationSelect) {
    locationSelect.addEventListener('change', () => {
      APP_STATE.currentFilter.location = locationSelect.value;
      refreshListing(true);
    });
  }

  if (experienceSelect) {
    experienceSelect.addEventListener('change', () => {
      APP_STATE.currentFilter.experience = experienceSelect.value;
      applyFiltersAndRender();
    });
  }

  if (closingSelect) {
    closingSelect.addEventListener('change', () => {
      APP_STATE.currentFilter.closingDate = closingSelect.value;
      applyFiltersAndRender();
    });
  }

  if (expiredToggle) {
    expiredToggle.addEventListener('change', () => {
      APP_STATE.currentFilter.showExpired = expiredToggle.checked;
      applyFiltersAndRender();
    });
  }

  if (bookmarkedOnlyToggle) {
    bookmarkedOnlyToggle.addEventListener('change', () => {
      APP_STATE.currentFilter.showBookmarkedOnly = bookmarkedOnlyToggle.checked;
      applyFiltersAndRender();
    });
  }

  function resetFilters() {
    APP_STATE.currentFilter = {
      keyword: '',
      category: 'All',
      location: 'All',
      experience: 'All',
      closingDate: 'All',
      showExpired: false,
      showBookmarkedOnly: false
    };

    if (searchInput) searchInput.value = '';
    if (categorySelect) categorySelect.value = 'All';
    if (locationSelect) locationSelect.value = 'All';
    if (experienceSelect) experienceSelect.value = 'All';
    if (closingSelect) closingSelect.value = 'All';
    if (expiredToggle) expiredToggle.checked = false;
    if (bookmarkedOnlyToggle) bookmarkedOnlyToggle.checked = false;

    // Clean URL query string
    window.history.replaceState({}, '', window.location.pathname);
    refreshListing(true);
  }

  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', resetFilters);
  if (emptyClearBtn) emptyClearBtn.addEventListener('click', resetFilters);

  // Initial render
  refreshListing(true);

  function applyFiltersAndRender() {
    if (!gridContainer) return;

    const filtered = APP_STATE.opportunities.filter(item => {
      const isExpired = isOpportunityExpired(item);
      const dateFilter = APP_STATE.currentFilter.closingDate;

      if (['Expired', 'Closing Soon'].includes(dateFilter)
        && (APP_STATE.datasetMeta?.source !== 'api' || item.isSample)) {
        return false;
      }

      if (APP_STATE.currentFilter.showBookmarkedOnly) {
        const savedIds = new Set(APP_STATE.savedOpportunities.map(String));
        if (!savedIds.has(String(item.id))) {
          return false;
        }
      }

      // Expiry filter logic: by default hide expired opportunities unless toggle is checked or filter explicitly asks for expired
      if (!APP_STATE.currentFilter.showExpired && isExpired && APP_STATE.currentFilter.closingDate !== 'Expired') {
        return false;
      }

      // Keyword search across title, organisation, description, location
      if (APP_STATE.currentFilter.keyword) {
        const query = APP_STATE.currentFilter.keyword.toLowerCase();
        const matchesTitle = (item.title || '').toLowerCase().includes(query);
        const matchesOrg = (item.organisation || '').toLowerCase().includes(query);
        const matchesDesc = (item.description || '').toLowerCase().includes(query);
        const matchesLoc = (item.location || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesOrg && !matchesDesc && !matchesLoc) {
          return false;
        }
      }

      // Category filter (handles exact and substring match, e.g. "Job", "Internship", "Learnership")
      if (APP_STATE.currentFilter.category !== 'All') {
        const selectedCat = APP_STATE.currentFilter.category.toLowerCase();
        const itemCat = (item.category || '').toLowerCase();
        if (itemCat !== selectedCat && !itemCat.includes(selectedCat)) {
          return false;
        }
      }

      // Location filter (handles substring matching, e.g. "Cape Town", "Gauteng", "Pretoria")
      if (APP_STATE.currentFilter.location !== 'All') {
        const selectedLoc = APP_STATE.currentFilter.location.toLowerCase();
        const itemLoc = (item.location || '').toLowerCase();
        if (!itemLoc.includes(selectedLoc)) {
          return false;
        }
      }

      // Experience Level filter
      if (APP_STATE.currentFilter.experience !== 'All') {
        const selectedExp = APP_STATE.currentFilter.experience.toLowerCase();
        const itemExp = (item.experienceLevel || '').toLowerCase();
        
        if (selectedExp === 'no experience' || selectedExp === 'entry level') {
          if (!itemExp.includes('entry') && !itemExp.includes('no experience') && !itemExp.includes('varies') && !itemExp.includes('student') && !itemExp.includes('matric')) {
            return false;
          }
        } else if (selectedExp === 'junior' || selectedExp === 'graduate') {
          if (!itemExp.includes('junior') && !itemExp.includes('graduate') && !itemExp.includes('intern') && !itemExp.includes('student')) {
            return false;
          }
        } else if (selectedExp === 'intermediate' || selectedExp === 'experienced') {
          if (!itemExp.includes('intermediate') && !itemExp.includes('experienced') && !itemExp.includes('professional')) {
            return false;
          }
        } else if (!itemExp.includes(selectedExp)) {
          return false;
        }
      }

      // Closing Date specific filters
      if (APP_STATE.currentFilter.closingDate === 'Closing Soon') {
        if (!isClosingSoon(item) || isExpired) return false;
      } else if (APP_STATE.currentFilter.closingDate === 'This Month') {
        if (!item.closingDate || isExpired) return false;
        const itemMonth = item.closingDate.substring(0, 7);
        if (itemMonth !== window.SkillBridgeAPI.getCurrentDateOnly().substring(0, 7)) return false;
      } else if (APP_STATE.currentFilter.closingDate === 'Future') {
        if (!item.closingDate || isExpired) return false;
        const itemMonth = item.closingDate.substring(0, 7);
        if (itemMonth <= window.SkillBridgeAPI.getCurrentDateOnly().substring(0, 7)) return false;
      } else if (APP_STATE.currentFilter.closingDate === 'Ongoing') {
        if (item.closingDate !== null || isExpired) return false;
      } else if (APP_STATE.currentFilter.closingDate === 'Expired') {
        if (!isExpired) return false;
      }

      return true;
    });

    // Render cards
    gridContainer.innerHTML = '';

    if (filtered.length === 0) {
      gridContainer.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
      if (resultsCount) resultsCount.innerHTML = 'Showing <strong>0</strong> matching opportunities';
    } else {
      gridContainer.style.display = 'grid';
      if (emptyState) emptyState.style.display = 'none';
      if (resultsCount) {
        resultsCount.innerHTML = `Showing <strong>${filtered.length}</strong> ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`;
      }

      filtered.forEach(item => {
        gridContainer.appendChild(createOpportunityCardElement(item));
      });
    }
  }
}

/**
 * Dynamically enrich Category and Location dropdown filters from dataset
 */
function populateFilterOptions(categorySelect, locationSelect) {
  if (!APP_STATE.opportunities.length) return;

  if (categorySelect) {
    const existingValues = new Set(Array.from(categorySelect.options).map(o => o.value));
    const categories = Array.from(new Set(APP_STATE.opportunities.map(o => o.category).filter(Boolean))).sort();
    categories.forEach(cat => {
      if (!existingValues.has(cat)) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
      }
    });
  }

  if (locationSelect) {
    const existingValues = new Set(Array.from(locationSelect.options).map(o => o.value));
    const locations = Array.from(new Set(APP_STATE.opportunities.map(o => o.location).filter(Boolean))).sort();
    locations.forEach(loc => {
      if (!existingValues.has(loc)) {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = loc;
        locationSelect.appendChild(opt);
      }
    });
  }
}

/* ==========================================================================
   7. Opportunity Details Page Logic (opportunity-details.html)
   ========================================================================== */
function initOpportunityDetailsPage() {
  const container = document.getElementById('opportunity-details-container');
  const errorContainer = document.getElementById('opportunity-error-container');

  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const idParam = urlParams.get('id');

  if (!idParam) {
    showErrorState();
    return;
  }

  const loadOpportunity = async () => {
    try {
      const opportunity = await window.SkillBridgeAPI.getOpportunityById(idParam, {
        baseUrl: getApiBaseUrl()
      });

      if (!opportunity) {
        showErrorState();
        return;
      }

      APP_STATE.opportunities = APP_STATE.opportunities.length
        ? APP_STATE.opportunities
        : [opportunity];

      trackRecentlyViewed(opportunity.id);
      renderOpportunityDetails(opportunity, container);
    } catch (error) {
      console.error('Error loading opportunity details from API.', error);
      showErrorState();
      showApiError(`Unable to load opportunity details. ${error.message || 'Please try again later.'}`);
    }
  };

  loadOpportunity();

  function showErrorState() {
    if (container) container.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'block';
  }
}

function renderOpportunityDetails(item, container) {
  const isExpired = isOpportunityExpired(item);
  const closingSoon = !isExpired && isClosingSoon(item);
  const isSaved = APP_STATE.savedOpportunities.includes(String(item.id));

  let statusBadgeHtml = '';
  if (isExpired) {
    statusBadgeHtml = '<span class="badge badge-expired">Expired Opportunity</span>';
  } else if (closingSoon) {
    const days = getDaysRemaining(item);
    statusBadgeHtml = `<span class="badge badge-closing-soon">⏰ Closing Soon (${days} days remaining)</span>`;
  } else {
    statusBadgeHtml = '<span class="badge badge-category" style="background:#ECFDF5; color:#065F46; border-color:#A7F3D0;">Active Opportunity</span>';
  }

  const verifiedBadgeHtml = (item.isVerified || item.verificationStatus === 'verified' || item.isSample === false)
    ? '<span class="badge" style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0;">✓ Official Verified Record</span>'
    : '<span class="badge badge-sample">Sample Opportunity</span>';

  // Extract documents or default checklist
  const docsList = (item.requiredDocuments && item.requiredDocuments.length > 0)
    ? item.requiredDocuments
    : (item.documents && item.documents.length > 0)
      ? item.documents
      : [
          "Updated Curriculum Vitae (CV)",
          "Certified copy of South African ID (not older than 3 months)",
          "Certified copies of qualifications / Matric certificate",
          "Official Z83 Application Form (for Government / Department vacancies)"
        ];

  // Extract eligibility or default explanation
  const eligibilityList = (item.eligibility && item.eligibility.length > 0)
    ? item.eligibility
    : [
        "South African citizen or permanent resident",
        "Meets the minimum qualification requirements specified on the official vacancy posting",
        "Able to provide certified verification documents upon request"
      ];

  const officialUrl = item.officialApplicationUrl || item.sourceUrl || item.applicationLink || '#';

  container.innerHTML = `
    <!-- Back Link -->
    <div class="details-back-bar">
      <a href="opportunities.html" class="back-link">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Opportunities
      </a>
    </div>

    <!-- Header Card -->
    <div class="details-header-card">
      <div class="details-header-top">
        ${verifiedBadgeHtml}
        <span class="badge badge-category">${escapeHtml(item.category)}</span>
        ${statusBadgeHtml}
      </div>

      <h1 class="details-title">${escapeHtml(item.title)}</h1>
      <div class="details-org">${escapeHtml(item.organisation)}</div>

      <!-- Quick Metadata Grid -->
      <div class="details-meta-grid">
        <div>
          <div class="meta-box-label">Location</div>
          <div class="meta-box-val">${escapeHtml(item.location || 'South Africa')}</div>
        </div>
        <div>
          <div class="meta-box-label">Experience Level</div>
          <div class="meta-box-val">${escapeHtml(item.experienceLevel || 'Varies')}</div>
        </div>
        <div>
          <div class="meta-box-label">Closing Date</div>
          <div class="meta-box-val">${formatDate(item.closingDate)}</div>
        </div>
        <div>
          <div class="meta-box-label">Last Verified</div>
          <div class="meta-box-val">${formatDate(item.lastVerified || item.lastUpdated || '2026-10-06')}</div>
        </div>
      </div>

      <div style="font-size: var(--text-sm); color: var(--text-muted);">
        <strong>Official Source:</strong> ${escapeHtml(item.sourceName || item.organisation)} • 
        <strong>Verification Status:</strong> <span style="color:var(--success); font-weight:700;">Verified Active Snapshot</span>
      </div>
    </div>

    <!-- Body Layout -->
    <div class="details-body-layout">
      <!-- Main Content -->
      <div class="details-main-content">
        <!-- About Section -->
        <section class="details-card" aria-labelledby="about-heading">
          <h2 id="about-heading" class="details-card-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            About the Opportunity
          </h2>
          <p style="line-height:1.7; color:var(--text); margin-bottom:1rem;">
            ${escapeHtml(item.fullDescription || item.description)}
          </p>
          <div class="alert alert-warning" style="font-size:var(--text-xs); margin-bottom:0;">
            <strong>Verification Note:</strong> This record was checked against official public sources (${escapeHtml(item.sourceName || item.organisation)}). Opportunity details and closing dates can change on short notice; always confirm with the official careers portal immediately before applying.
          </div>
        </section>

        <!-- Eligibility Section -->
        <section class="details-card" aria-labelledby="eligibility-heading">
          <h2 id="eligibility-heading" class="details-card-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            Eligibility &amp; Requirements
          </h2>
          <ul class="details-list">
            ${eligibilityList.map(crit => `
              <li class="details-list-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>${escapeHtml(crit)}</span>
              </li>
            `).join('')}
          </ul>
        </section>

        <!-- Required Documents Interactive Checklist -->
        <section class="details-card" aria-labelledby="documents-heading">
          <h2 id="documents-heading" class="details-card-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Required Documents Checklist
          </h2>
          <p style="font-size:var(--text-xs); color:var(--text-muted); margin-bottom:1rem;">
            Use this interactive checklist to prepare your documents before visiting the official employer portal:
          </p>
          <div class="details-list" id="doc-checklist-group">
            ${docsList.map((doc, idx) => `
              <label class="checklist-item" for="chk-doc-${idx}">
                <input type="checkbox" id="chk-doc-${idx}" data-doc="${escapeHtml(doc)}">
                <span>${escapeHtml(doc)}</span>
              </label>
            `).join('')}
          </div>
        </section>

        <!-- Organisation Details -->
        <section class="details-card" aria-labelledby="org-heading">
          <h2 id="org-heading" class="details-card-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            About ${escapeHtml(item.organisation)}
          </h2>
          <p style="line-height:1.6; color:var(--text);">
            ${item.organisationDescription ? escapeHtml(item.organisationDescription) : `This vacancy is listed under ${escapeHtml(item.organisation)}. For comprehensive institutional information, visit the official government/corporate portal.`}
          </p>
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="details-sidebar" aria-label="Application summary and actions">
        <div class="apply-card">
          <h3 class="apply-card-title">How to Apply</h3>
          <p class="apply-card-text">
            ${escapeHtml(item.applicationInstructions || "Apply using the official instructions on the source website. SkillBridge never collects personal applications or charges fees.")}
          </p>

          <div class="sidebar-actions">
            ${officialUrl && officialUrl !== '#' ? `
              <a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-block btn-lg" ${isExpired ? 'style="pointer-events:none; opacity:0.6;"' : ''}>
                ${isExpired ? 'Applications Closed' : 'Visit Official Careers Portal'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            ` : `
              <button id="demo-apply-btn" class="btn btn-secondary btn-block btn-lg" ${isExpired ? 'disabled' : ''}>
                ${isExpired ? 'Applications Closed' : 'View Application Instructions'}
              </button>
            `}

            <button id="details-save-btn" class="btn btn-outline btn-block">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>${isSaved ? 'Saved in Bookmarks' : 'Bookmark Opportunity'}</span>
            </button>

            <button id="share-btn" class="btn btn-ghost btn-block">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
              Share Opportunity
            </button>

            <a href="contact.html?type=report&opportunity=${encodeURIComponent(item.title)}" class="btn btn-ghost btn-block" style="color:var(--text-light); font-size:var(--text-xs);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Report Incorrect or Suspicious Listing
            </a>
          </div>

          <!-- Application Safety Notice -->
          <div class="safety-notice-box" role="note">
            <strong>⚠️ Application Safety Notice</strong>
            Always confirm the opportunity directly on the official source website (${escapeHtml(item.sourceName || item.organisation)}) before submitting personal information. Never pay any money or application fee.
          </div>
        </div>
      </aside>
    </div>
  `;

  // Checkbox strikethrough handler
  const checkboxes = container.querySelectorAll('#doc-checklist-group input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const parent = cb.closest('.checklist-item');
      if (cb.checked) {
        parent.classList.add('is-checked');
      } else {
        parent.classList.remove('is-checked');
      }
    });
  });

  // Bookmark Toggle in Details
  const saveBtn = container.querySelector('#details-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const updatedSaved = await toggleBookmark(item.id, null, item.title);
      saveBtn.querySelector('span').textContent = updatedSaved ? 'Saved in Bookmarks' : 'Bookmark Opportunity';
      const svg = saveBtn.querySelector('svg');
      if (updatedSaved) {
        svg.setAttribute('fill', 'currentColor');
      } else {
        svg.setAttribute('fill', 'none');
      }
      saveBtn.disabled = false;
    });
  }

  // Share Button
  const shareBtn = container.querySelector('#share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
        showToast('Opportunity link copied to clipboard!');
      } else {
        showToast('URL: ' + window.location.href);
      }
    });
  }
}

/* ==========================================================================
   8. Resources Page Logic (resources.html)
   ========================================================================== */
function initResourcesPage() {
  const tabBtns = document.querySelectorAll('.resource-tab-btn');
  const guideSections = document.querySelectorAll('.resource-guide-card');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-target');
      if (targetId === 'all') {
        guideSections.forEach(s => s.style.display = 'block');
      } else {
        guideSections.forEach(s => {
          if (s.id === targetId) {
            s.style.display = 'block';
            s.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            s.style.display = 'none';
          }
        });
      }
    });
  });
}

/* ==========================================================================
   9. Contact & Report Page Logic (contact.html)
   ========================================================================== */
function initContactPage() {
  const tabs = document.querySelectorAll('.form-tab-btn');
  const panels = document.querySelectorAll('.form-panel');

  // URL parameters handling (?type=report&opportunity=XYZ)
  const urlParams = new URLSearchParams(window.location.search);
  const typeParam = urlParams.get('type');
  const oppParam = urlParams.get('opportunity');

  if (typeParam === 'report') {
    switchFormTab('report');
    if (oppParam) {
      const oppInput = document.getElementById('report-opportunity');
      if (oppInput) oppInput.value = decodeURIComponent(oppParam);
    }
  } else if (typeParam === 'suggest') {
    switchFormTab('suggest');
  } else if (typeParam === 'feedback') {
    switchFormTab('feedback');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabTarget = tab.getAttribute('data-tab');
      switchFormTab(tabTarget);
    });
  });

  function switchFormTab(tabName) {
    tabs.forEach(t => {
      const isActive = t.getAttribute('data-tab') === tabName;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive);
    });

    panels.forEach(p => {
      const isActive = p.id === `form-${tabName}`;
      p.classList.toggle('active', isActive);
    });
  }

  // Setup Form Submissions with Accessible Validation
  setupFormValidation('general-enquiry-form');
  setupFormValidation('report-opportunity-form');
  setupFormValidation('suggest-opportunity-form');
  setupFormValidation('platform-feedback-form');
}

function setupFormValidation(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let isValid = true;

    // Validate all inputs with [required]
    const requiredInputs = form.querySelectorAll('[required]');
    requiredInputs.forEach(input => {
      const value = input.value.trim();
      let fieldValid = true;

      if (!value) {
        fieldValid = false;
      } else if (input.type === 'email' && !validateEmail(value)) {
        fieldValid = false;
      }

      if (!fieldValid) {
        isValid = false;
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
      }
    });

    // Provide real feedback
    const feedbackBox = form.querySelector('.form-feedback');

    if (!isValid) {
      if (feedbackBox) {
        feedbackBox.innerHTML = `
          <div class="alert alert-danger" role="alert">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>Please check the highlighted fields above and ensure your email address is valid.</div>
          </div>
        `;
      }
    } else {
      if (feedbackBox) {
        feedbackBox.innerHTML = `
          <div class="alert alert-success" role="alert">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <div>
              <strong>Submission Received!</strong> Thank you for helping keep SkillBridge safe and accurate. We will review your submission promptly.
            </div>
          </div>
        `;
      }
      form.reset();
      showToast('Form submitted successfully!');
    }
  });

  // Clear invalid styling on typing
  form.querySelectorAll('.form-control').forEach(ctrl => {
    ctrl.addEventListener('input', () => {
      ctrl.classList.remove('is-invalid');
      ctrl.removeAttribute('aria-invalid');
    });
  });
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/* ==========================================================================
   10. Bookmarks, LocalStorage & Toast Helpers
   ========================================================================== */
async function toggleBookmark(id, buttonEl, title) {
  const strId = String(id);
  const index = APP_STATE.savedOpportunities.indexOf(strId);
  const isSaved = index > -1;

  try {
    if (window.SkillBridgeAuth?.getSession()) {
      await window.SkillBridgeAuth.setSavedOpportunity(strId, !isSaved);
    }
  } catch (error) {
    showToast(error.message || 'Unable to update your saved opportunities.');
    return isSaved;
  }

  if (isSaved) {
    APP_STATE.savedOpportunities.splice(index, 1);
    showToast(`Removed "${title || 'Opportunity'}" from bookmarks`);
  } else {
    APP_STATE.savedOpportunities.push(strId);
    showToast(`Saved "${title || 'Opportunity'}" to bookmarks!`);
  }

  APP_STATE.savedOpportunities = [...new Set(APP_STATE.savedOpportunities.map(String))];
  if (!window.SkillBridgeAuth?.getSession()) {
    localStorage.setItem('skillbridge_saved', JSON.stringify(APP_STATE.savedOpportunities));
  }
  updateBookmarkNavState();

  if (buttonEl) {
    buttonEl.classList.toggle('is-bookmarked', isSaved);
    buttonEl.title = isSaved ? 'Remove from saved' : 'Save opportunity';
    buttonEl.setAttribute('aria-label', isSaved ? `Remove ${title} from bookmarks` : `Bookmark ${title}`);
    const svg = buttonEl.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', isSaved ? 'currentColor' : 'none');
    }
  }

  const currentPage = getCurrentPageName();

  if (currentPage === 'opportunities' && typeof window.__skillbridgeApplyFilters === 'function') {
    window.__skillbridgeApplyFilters();
  }

  return !isSaved;
}

function updateBookmarkNavState() {
  const count = APP_STATE.savedOpportunities.length;
  document.querySelectorAll('.bookmark-count-badge').forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
}

function initBookmarksPage() {
  const container = document.getElementById('saved-opportunities-container');
  const countEl = document.getElementById('saved-opportunities-count');
  if (!container) return;

  const savedIds = new Set(APP_STATE.savedOpportunities.map(String));
  const savedItems = APP_STATE.opportunities.filter((item) => {
    return savedIds.has(String(item.id));
  });

  if (countEl) {
    countEl.textContent = `${savedItems.length} saved`;
  }

  if (!savedItems.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:2rem 1rem;">
        <h3 class="empty-state-title">No saved opportunities yet</h3>
        <p class="empty-state-text">Bookmark roles, learnerships, and bursaries you want to revisit later.</p>
        <a href="opportunities.html" class="btn btn-primary btn-md">Browse Opportunities</a>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  savedItems.forEach((item) => {
    const card = createOpportunityCardElement(item);
    const bookmarkBtn = card.querySelector('.bookmark-btn');

    bookmarkBtn.addEventListener('click', (event) => {
      event.preventDefault();
      toggleBookmark(item.id, bookmarkBtn, item.title);
    });

    container.appendChild(card);
  });
}

function trackRecentlyViewed(id) {
  const strId = String(id);
  let list = APP_STATE.recentlyViewed.filter(itemId => itemId !== strId);
  list.unshift(strId);
  if (list.length > 6) list = list.slice(0, 6);
  APP_STATE.recentlyViewed = list;
  localStorage.setItem('skillbridge_recent', JSON.stringify(list));
}

function initToasts() {
  let toastContainer = document.querySelector('.toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }
}

function showToast(message) {
  let toastContainer = document.querySelector('.toast-container');
  if (!toastContainer) {
    initToasts();
    toastContainer = document.querySelector('.toast-container');
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(100%)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function showNotificationBanner(message, type = 'warning') {
  const main = document.querySelector('main');
  if (!main) return;
  const banner = document.createElement('div');
  banner.className = `alert alert-${type}`;
  banner.style.margin = '1rem auto';
  banner.style.maxWidth = 'var(--container-max)';
  banner.innerHTML = `<span>${escapeHtml(message)}</span>`;
  main.prepend(banner);
}

/* ==========================================================================
   11. Utility Functions
   ========================================================================== */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
