# SkillBridge — Youth Opportunity & Skills Platform

> **Primary Tagline:** Connecting Youth to Opportunities That Move Them Forward.  
> **Supporting Tagline:** Find opportunities. Build skills. Bridge your future.

SkillBridge is a modern, mobile-first web platform designed to help young South Africans discover jobs, internships, learnerships, bursaries, courses, and skills programmes in one accessible, trustworthy location.

The project is now a full-stack application: a Node.js + Express API serves data and auth configuration, while the same server also serves the static frontend from the project root. This allows the app to run as a single deployment on platforms like Render without the root route returning the JSON API 404 error.

# Live Demo
https://skillbridge-fullstack-wcj0.onrender.com/

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Problem Statement](#2-problem-statement)
3. [Project Goal](#3-project-goal)
4. [Target Users](#4-target-users)
5. [Proposed Solution](#5-proposed-solution)
6. [Key Features](#6-key-features)
7. [Technology Stack](#7-technology-stack)
8. [Project Structure](#8-project-structure)
9. [JSON Dataset Explanation](#9-json-dataset-explanation)
10. [Accessibility Features (WCAG 2.1)](#10-accessibility-features-wcag-21)
11. [Responsive Design Implementation](#11-responsive-design-implementation)
12. [How to Run Locally](#12-how-to-run-locally)
13. [Git & GitHub Version Control Instructions](#13-git--github-version-control-instructions)
14. [Deployment Instructions](#14-deployment-instructions)
15. [Testing & Quality Assurance](#15-testing--quality-assurance)
16. [Known Limitations](#16-known-limitations)
17. [Future Improvements](#17-future-improvements)
18. [Read-Only API Backend](#18-read-only-api-backend)

---

## 1. Introduction

Youth unemployment and fragmented access to entry-level career pathways represent one of South Africa's most urgent developmental challenges. Many talented matriculants, TVET graduates, and university leavers struggle to identify legitimate development pathways, understand application criteria, or protect themselves from predatory recruitment syndicates.

**SkillBridge** addresses this barrier by providing a clean, accessible, and transparent bridge between youth talent and verified opportunities.

---

## 2. Problem Statement

Young job seekers and learners face four recurring obstacles:
1. **Information Fragmentation:** Opportunities (bursaries, internships, learnerships, and jobs) are scattered across dozens of individual company websites, SETA notices, social media groups, and PDFs.
2. **Deceptive & Predatory Recruitment:** Unemployed youth are frequently targeted by syndicates demanding upfront "application fees," medical exam charges, or banking credentials.
3. **Unclear Requirements:** Job seekers often apply for roles without knowing what specific documents are required or how to certify their credentials.
4. **Poor Mobile Usability:** Many corporate application portals are built exclusively for desktop computers, alienating youth who access the internet primarily via mobile smartphones.

---

## 3. Project Goal

To build a high-performance, mobile-first, standards-compliant web application that allows a first-time user to:
* Instantly understand the platform’s purpose.
* Search and multi-filter opportunities based on keywords, category, location, experience level, and closing date.
* Inspect complete opportunity requirements, eligibility lists, and document checklists.
* Learn practical job application skills (CV building, STAR interview technique, certification).
* Report suspicious or outdated listings.
* Enjoy a seamless, accessible experience across mobile devices, tablets, and desktops.

---

## 4. Target Users

* **School Leavers & Matriculants:** Seeking bursaries, entry-level learnerships, and funded skills programmes.
* **TVET College & University Students:** Looking for vacation work, experiential learning, and graduate internships.
* **Unemployed Youth (Ages 18–35):** Searching for entry-level employment, vocational skills, and career transition pathways.
* **Community Career Mentors & Educators:** Assisting young people in identifying verified, safe opportunities.

---

## 5. Proposed Solution

SkillBridge provides a centralized, human-centered web application built around four pillars:
* **Discover:** Six distinct categories (Jobs, Internships, Learnerships, Bursaries, Courses, Skills Programmes) accessible through dynamic multi-criteria search.
* **Compare:** Side-by-side comparison of locations, experience tiers, closing dates, and stipends.
* **Prepare:** An integrated Career Resources hub covering CV writing, cover letters, STAR interview prep, certified document preparation, and scam defense.
* **Stay Safe:** Prominent recruitment scam awareness warnings, official domain verification guidelines, and a direct reporting workflow.

---

## 6. Key Features

### 6.1 Dynamic Opportunities Directory
* **Multi-Criteria Filtering:** Simultaneous filtering by Keyword, Category, Location, Experience Level, and Closing Date.
* **Closing Soon Calculation:** Automatically calculates remaining days until the deadline; flags opportunities closing within 7 days with a highlighted badge.
* **Automatic Expiration Handling:** Identifies closed opportunities based on deadline; removes expired listings from active views while offering a transparent review toggle.
* **Reactive Search:** Real-time, debounced keyword matching across title, organisation, description, and location.

### 6.2 Rich Opportunity Details View (`opportunity-details.html?id=...`)
* **Interactive Document Checklist:** Users can check off required documents (ID, CV, Matric Certificate) directly on page.
* **Demonstration Safety Modal:** Safe application button clearly labeled `Demo Application` that reinforces verification on official corporate portals without misleading links.
* **Deep Metadata:** Includes remuneration/stipend information, work mode (Hybrid, On-site, Remote), last updated date, and eligibility bullets.

### 6.3 Bookmarking & Local Storage Persistence
* Users can bookmark/save opportunities for later review across browser sessions.
* Tracks recently viewed opportunities in `localStorage`.

### 6.4 Career Resources & STAR Method Toolkit (`resources.html`)
* Comprehensive guides for CV structure, professional profiles (LinkedIn/GitHub), cover letters, document certification standards (3-month validity rule).
* Interactive STAR behavioral question framework (Situation, Task, Action, Result).
* Detailed recruitment scam warning signs.

### 6.5 Interactive Multi-Tab Contact & Report Center (`contact.html`)
* **General Enquiry Form:** For community queries.
* **Report an Opportunity Form:** Pre-fills opportunity titles from details page; categorizes report reasons (Expired, Suspicious, Incorrect info, Bad link).
* **Suggest an Opportunity Form:** Community submission for legitimate opportunities.
* **Accessible Validation:** Visual indicators (`is-invalid`), ARIA attributes (`aria-invalid`), descriptive error messages, and success notifications.

### 6.6 Theme Switching (Light & Dark Mode)
* Clean dark mode palette with automated contrast adjustment and persistence in `localStorage`.

---

## 7. Technology Stack

This application is strictly built with vanilla web technologies to highlight core competencies:

* **HTML5:** Semantic architecture (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`), ARIA attributes.
* **CSS3:** Custom properties (CSS variables), Flexbox, CSS Grid, media queries, subtle micro-interactions, responsive typography.
* **Vanilla JavaScript (ES6+):** Async/await `fetch`, DOM manipulation, query string parsing (`URLSearchParams`), `localStorage`, array filters, event delegation.
* **JSON:** Structured data source representing demonstration opportunities.
* **Vector Graphics (SVG):** Custom-designed vector logo, favicon, and hero pathway illustration.
* **Read-only backend (Stage 2):** Node.js, Express, and the Supabase JavaScript client.

> **Frontend:** No React, Vue, Angular, Bootstrap, or Tailwind CSS are used. The Stage 2 API is separate from the existing frontend.

---

## 8. Project Structure

```text
SkillBridge/
│
├── index.html                   # Home page with hero, categories, and opportunity view
├── register.html                # Candidate registration
├── login.html                   # Candidate login
├── profile.html                 # Candidate dashboard and saved opportunities
├── opportunities.html           # Searchable directory with filters and pagination
├── opportunity-details.html     # Opportunity detail page
├── resources.html               # Career skill and scam-awareness content
├── contact.html                 # Contact and reporting forms
│
├── css/
│   └── style.css                # Mobile-first design system and theme styles
│
├── js/
│   ├── api.js                   # Shared API client for /api requests
│   ├── auth.js                  # Supabase Auth and saved-opportunity logic
│   ├── script.js                # Shared frontend rendering logic
│   ├── theme.js                 # Persisted light/dark theme handling
│   └── admin.js                 # Admin auth checks and dashboard behaviour
│
├── data/
│   └── opportunities.json       # Legacy sample dataset kept for reference/demo use
│
├── server/
│   ├── app.js                   # Express app, static file hosting, API routes, and 404 handling
│   ├── index.js                 # Server startup, env validation, and port binding
│   └── lib/
│       ├── opportunities.js     # Read-only Supabase opportunity queries
│       └── supabase.js          # Public-key validation and Supabase client setup
│
├── supabase/
│   └── migrations/              # Candidate profile and saved-opportunity schema policies
│
├── test/
│   ├── api.test.js              # API and root-route regression tests
│   └── theme.test.js            # Theme preference tests
│
├── images/
│   ├── logo.svg                 # Brand illustration
│   ├── favicon.svg              # Browser icon
│   └── hero-pathway.svg         # Hero image asset
│
├── package.json                 # Node.js app scripts and dependencies
├── package-lock.json            # Locked dependency tree
├── .env.example                 # Example environment configuration
├── .gitignore                   # Ignores local secrets
├── .env                         # Local environment secrets (not committed)
├── README.md                    # Project documentation
└── LICENSE                      # Project license (if present)
```

---

## 9. JSON Dataset Explanation

The existing frontend dataset at `data/opportunities.json` contains **100 records** in a top-level `opportunities` array. Its IDs are text values (for example, `skillbridge-001`) and its frontend fields use camelCase, such as `closingDate` and `isVerified`. The JSON file remains the legacy frontend source during Stage 2; the new API reads the existing Supabase table and does not use this file as a fallback.

### Data Schema

Each JSON opportunity uses legacy camelCase fields such as `id`, `title`, `organisation`, `category`, `location`, `closingDate`, `experienceLevel`, `description`, `eligibility`, `requiredDocuments`, `applicationInstructions`, `officialApplicationUrl`, `sourceUrl`, `sourceName`, `lastVerified`, `verificationStatus`, `verificationLevel`, `status`, `isVerified`, and `isSample`. All 100 current records have `isSample: false` and `verificationStatus: "verified"`; 87 are marked active and 13 expired. These records are not queried by the Stage 2 API.

The Supabase migration `20261028100000_close_expired_opportunities.sql` allows the `closed` status, marks every record with a past `closing_date` as closed, and keeps verified expired records readable through the public API for the Expired filter. Apply pending migrations to the Supabase project when deploying this change.

---

## 10. Accessibility Features (WCAG 2.1)

* **Skip Navigation Link:** `<a href="#main-content" class="skip-link">Skip to main content</a>` allows keyboard users to bypass top navigation.
* **Keyboard Navigable:** All interactive controls (buttons, links, search inputs, modal close) are accessible via `Tab` and `Enter`/`Space`.
* **Visible Focus Indicators:** Customized `:focus-visible` outline rings with strong color contrast.
* **Screen Reader Optimization:** Semantic headings (`<h1>` through `<h4>`), ARIA attributes (`aria-expanded`, `aria-controls`, `aria-label`, `aria-live="polite"`).
* **High Contrast Ratios:** Deep navy text on off-white backgrounds (exceeding WCAG AAA contrast ratio > 7:1).
* **Non-Color Reliance:** Badges use icons and descriptive text (e.g. `⏰ Closing Soon (4 days left)`) rather than relying purely on color.

---

## 11. Responsive Design Implementation

The site uses a strict **mobile-first** CSS architecture tested across multiple viewports:

| Breakpoint | Target Devices | Design Adjustments |
|---|---|---|
| **320px – 375px** | Small Smartphones (e.g., iPhone SE) | Single column layout, touch targets >= 44px, full-width buttons. |
| **768px** | Tablets & Foldables (e.g., iPad) | Two-column grid layouts for opportunity cards and features. |
| **1024px** | Small Laptops & Desktops | Full horizontal navigation bar, multi-column search filter bar. |
| **1440px+** | Large Desktop Monitors | Max container constrained to 1200px with centered breathing room. |

* No horizontal scrollbars.
* Flexible SVG graphics that scale crisply at any pixel density.

---

## 12. How to Run Locally

This project is a full-stack Node.js app. Start the server from the project root so both the static frontend and the `/api` routes are available.

### 1) Install dependencies
```bash
npm install
```

### 2) Create your environment file
Copy the example file and fill in the required values:

```bash
copy .env.example .env
```

Then set:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
PORT=3000
```

### 3) Run the app
```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

The Express server serves the frontend at `/` and the API under `/api/*`.

### Alternative: production start
```bash
npm start
```

---

## 13. Git & GitHub Version Control Instructions

To initialize and push this project to your GitHub repository:

```bash
# 1. Initialize git repository
git init

# 2. Add all project files
git add .

# 3. Create initial commit
git commit -m "feat: complete modern SkillBridge youth opportunity platform"

# 4. Rename main branch
git branch -M main

# 5. Connect your remote GitHub repository
git remote add origin https://github.com/<your-username>/SkillBridge.git

# 6. Push code to GitHub
git push -u origin main
```

---

## 14. Deployment Instructions

This project is ready to deploy as a single Node.js app. The Express server serves both the frontend and the API from the same process, so the root path works correctly on hosts like Render.

### 14.1 Deploying to Render
1. Push this repository to GitHub.
2. In Render, create a **New** > **Web Service**.
3. Connect the repository and choose the root folder.
4. Set the build command to:

```bash
npm install
```

5. Set the start command to:

```bash
npm start
```

6. Add the environment variables in Render:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
PORT=3000
```

> Render injects `PORT` automatically in many cases, but the app also accepts the value if you define it explicitly.

The app root is served by Express, so the site loads at `/` and the API remains available under `/api/*`. This also fixes the previous issue where the root route returned `{"error":{"code":"NOT_FOUND","message":"Endpoint not found."}}`.

### 14.2 Deploying to GitHub Pages
GitHub Pages is suitable only for the static frontend shell if you are hosting the HTML/CSS/JS without the API. This project’s full-stack behavior is designed for Node-based hosting, not purely static hosting.

### 14.3 Deploying to Netlify / Vercel
The app is not optimized as a pure static site because it depends on the Express API and Supabase auth configuration. These platforms can work only if you configure a Node runtime or a serverless wrapper, which is not the primary deployment target for this repository.

---

## 15. Testing & Quality Assurance

The application underwent rigorous manual and automated test suites:

* **Navigation Verification:**
  - All navigation links route correctly across all 5 pages.
  - Mobile hamburger drawer opens, closes, traps focus, and closes on `Esc`.
  - Skip to main content link works with keyboard `Tab` navigation.
* **Search Functionality:**
  - Case-insensitive multi-field search across title, organisation, location, and description.
  - Debounced input prevents excessive re-renders.
* **Filter Functionality:**
  - Category, Location, Experience Level, and Closing Date filters operate simultaneously.
  - "Clear Filters" button resets all inputs and updates the URL and DOM dynamically.
* **Opportunity Details:**
  - URL parameter `?id=X` correctly renders the matching opportunity.
  - Fallback error state displayed if an invalid ID is provided.
  - Interactive document checklist allows users to toggle required items.
  - Demo application modal opens with clear educational notice.
* **Form Validation:**
  - Email format validation using regex.
  - Required fields highlight with `.is-invalid` and announce errors via ARIA.
  - Success banner rendered on completion with form reset.
* **Expired & Closing-Soon Logic:**
  - Opportunities closing within 7 days display warm amber badge and countdown label.
  - Expired opportunities are excluded from active listings and upcoming deadlines.

---

## 16. Known Limitations

* **Client-Side Simulation:** Data is loaded from a static `opportunities.json` rather than a live relational database with real-time employer APIs.
* **Local Storage Scope:** Bookmarked opportunities are stored within the specific browser's `localStorage` and do not sync across different physical devices.
* **Demonstration Submissions:** The contact and report forms simulate server processing and display client-side validation confirmations rather than sending backend emails.

---

## 17. Future Improvements

* **Email Notification Alerts:** Allow youth to subscribe to email alerts for specific categories or cities.
* **Offline PWA Support:** Add a service worker and web manifest to enable full offline access in low-bandwidth areas.
* **CV Builder Tool:** An interactive browser tool allowing youth to fill in their details and generate a downloadable PDF CV.
* **Multi-language Support:** Add interface translations in isiZulu, Sesotho, and Afrikaans to expand accessibility across South Africa.

---

## 18. Read-Only API Backend

Stage 2 adds an Express API for public reads from the existing Supabase `public.opportunities` table. The API is separate from the current frontend, which continues to load `data/opportunities.json`.

### Requirements and setup

- Node.js **20.6 or later** and npm.
- Install dependencies from the project root:

```powershell
npm install
copy .env.example .env
```

Edit `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or the legacy public `SUPABASE_ANON_KEY`). `PORT` is optional and defaults to `3000`. Use only a Supabase publishable/anon key; privileged keys are rejected. `.env` is ignored by Git.

### Start and test

```powershell
npm run dev
```

For a production start, use `npm start` after setting the same environment variables in the Node.js host. Run the database-independent API tests with:

```powershell
npm test
```

### Endpoints

- `GET /api/health` — liveness response: `{ "ok": true, "service": "skillbridge-api" }`.
- `GET /api/opportunities?q=developer&category=Job&location=Johannesburg&page=1&limit=20&sort=closing_date` — paginated list with `{ "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }`. `q` searches title, organisation, description, and location; category is an exact filter; location is a case-insensitive partial filter. `page` must be positive, `limit` is 1–100, and `sort` is `closing_date` or `newest`.
- `GET /api/opportunities/skillbridge-106` — one opportunity by its text ID, returned as `{ "item": { ... } }`.

Successful reads return `200`; invalid query/ID input returns `400`; an unknown or ineligible ID returns `404`; unexpected failures return a sanitized `500` JSON error. List results include only active, verified, non-sample opportunities with `verification_status = 'verified'`. Supabase RLS remains enabled and authoritative, including its current-date deadline rule: null deadlines remain eligible and expired records are excluded. The API applies the same status/verification checks and narrows results to `verification_status = 'verified'`; the supplied RLS eligibility description does not list that verification-status check, so API access is intentionally stricter. No policy changes are made.

To keep keyword matching and totals accurate without constructing a raw PostgREST `or` expression from user input, the API reads eligible matches for each searchable field, deduplicates them by ID, then sorts and paginates in memory. This is appropriate for the current directory but may need a database-supported search strategy if the public dataset grows substantially.

This stage is read-only: it does not change the Supabase schema or any opportunity records. Tests use injected/mock data access and do not connect to Supabase.

### Candidate authentication and authorization

Registration and login use the Supabase browser client with persisted, automatically refreshed Supabase sessions. The browser receives only the publishable/anon key through `GET /api/auth-config`; never expose a service-role key. Configure the API's `SUPABASE_URL` and public key in `.env`, and set the Supabase Auth Site URL and allowed redirect URLs for the local or deployed site. Email confirmation follows the Supabase project's Auth settings.

Apply `supabase/migrations/20261020140000_candidate_profiles_and_saved_opportunities.sql` before using candidate accounts. Supabase Auth creates the identity; an `auth.users` database trigger creates the candidate profile from validated user metadata, with a fallback name. Passwords are handled only by Supabase Auth and are never copied into application tables. The profile table has no client insert grant, and its row-level security policies allow a candidate to read and update only their own profile. Saved opportunities have equivalent owner-only select, insert, and delete policies. The profile page also filters by the active user ID, but database RLS is the authorization boundary.

After login, candidates land on a dashboard with the saved count and list, current verified opportunity count, recently added listings, device-local recently viewed items, and editable profile basics. The recent-history list remains on the current browser/device and is not synced to the account. Application tracking, personalized recommendations, and notification preferences are not implemented and are not presented as available features. The dashboard theme follows the operating-system preference by default and persists a candidate's explicit light/dark choice.

Published opportunity browsing remains public. This project does not implement administrator or opportunity-manager roles, private enquiries, or public role assignment. Privileged opportunity changes are not granted to candidates; any future elevated role must be assigned through a trusted administrative process and enforced in database policies or a validated backend.

---

## License & Credits

* **Project:** SkillBridge (Academic Frontend Demonstration)
* **Author:** Princely Makhwara
* **Year:** 2026
* **Disclaimer:** This website is an educational demonstration project. Opportunities displayed are sample demonstration records. Always verify vacancies through the official company or institution domains.
