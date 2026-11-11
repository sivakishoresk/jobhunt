# Jobhunt

A private job-search workbench that you host yourself and connect to Claude.

- **Search** LinkedIn and Y Combinator's Work at a Startup through Apify, from the page or by asking Claude.
- **Filter** instantly in the browser: text, score, posted date, remote, salary, source. Matches are highlighted.
- **Past searches.** Every search is kept. Open one from the left rail to see only the listings it returned, or tick "Only new" to see just what it found for the first time. Jobs you already had are still listed under the search that returned them.
- **Role and place filters.** Inside a search that covered several roles or places, chips for each role and place (with counts) split its listings by which run found them. Seniority chips appear whenever the listings differ.
- **Experience.** Each posting's years of experience are read from its text (the highest requirement found; shown as "3–5 yrs" or "5+ yrs"). Filter by a range, and choose whether to keep postings that don't say. For LinkedIn you can also pick experience levels before searching, which LinkedIn applies before you are billed.
- **Triage** with the keyboard: `j`/`k` move, `s` save, `x` dismiss, `a` mark applied, `u` undo, `/` filter, `?` help.
- **Claude scores and drafts.** Claude reads your profile and the postings, scores fit, and saves a tailored resume and cover letter. You review and edit them in the app, then download DOCX or print to PDF.
- **Nothing is ever sent for you.** Statuses only record what you did.

Claude never invents experience. It saves drafts by profile ids (`exp-1`, `proj-1`, …); the server fills in titles, employers and dates from your profile, and a checker flags any number, tool or employer in a draft that isn't in your profile or the posting.

## What you need

| Account | Cost | Used for |
|---|---|---|
| Vercel | Free Hobby plan is enough | Hosts the app |
| Neon (Postgres) | Free plan is enough | Stores jobs, profile, drafts |
| Apify | Pay as you go; free monthly credit | Runs the job scrapers |
| Claude (Pro, Max, Team or Enterprise) | Your existing plan | Custom connectors |

## Deploy

1. **Put the code on GitHub.** Unzip this folder, then create a new private repository and push it.
   ```
   cd jobhunt
   git init && git add . && git commit -m "Jobhunt"
   git remote add origin https://github.com/<you>/jobhunt.git
   git push -u origin main
   ```
2. **Import it into Vercel.** vercel.com → Add New → Project → pick the repository. Framework is detected as Next.js. Don't deploy yet.
3. **Add a database.** In the Vercel project: Storage → Create → Neon (Postgres). Connect it to the project. This sets `DATABASE_URL` for you. Tables are created automatically on first request.
4. **Set environment variables** (Settings → Environment Variables, all environments):

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | 32+ random characters. Run `openssl rand -base64 48`. |
   | `APIFY_TOKEN` | Apify Console → Settings → API & Integrations. Used for the owner account only; other people add their own. |
   | `OWNER_USERNAME`, `OWNER_PASSWORD` | Optional. The first account, created on first start. Default `sksiva` / `sksiva`. Change the password in Settings → Account straight away. |
   | `ALLOW_SIGNUP` | Optional. `false` hides account creation on the login page. |
   | `APIFY_MAX_CHARGE_USD` | Optional. Cap per run for pay-per-event actors. Default `1`. |

   Everything else in `.env.example` is optional.
5. **Deploy.** Open the Vercel URL and sign in as the owner (default `sksiva` / `sksiva`), then change the password in **Settings → Account**. Other people use **Create account** on the login page.
6. **Fill in your profile** (Profile page): basics, skills, experience, projects, education, publications. This is the only source Claude may draw on for your resume.

## User guide

`/guide` is a public page (no sign-in needed) that walks a new person through setup with a progress checklist, a simulated Claude chat for each step (profile from résumé, search, score, draft, track), a copyable prompt library, an app tour and FAQs. The login page and the nav bar link to it. The examples on it are made up and touch no data.

## Connect Claude

1. In the app, open **Settings** and copy the connector address. It ends in `/api/mcp`.
2. In Claude: Settings → Connectors → Add custom connector. Paste the address. Leave client ID and secret blank unless the form insists (then see `OAUTH_CLIENT_ID` in `.env.example`).
3. Claude opens a Jobhunt page. Sign in with your Jobhunt username and password and choose **Allow access**. Claude then sees only your own data. (Connectors made before accounts existed must be removed and added again once.)
4. Start a chat: *"Using Jobhunt, find machine learning engineer jobs in Bengaluru posted this week and score them against my profile."*

Claude Code (command line) can use the OAuth flow too, or the fixed-token route: set `MCP_API_TOKEN` on Vercel and run
`claude mcp add --transport http jobhunt https://<your-app>/api/mcp --header "Authorization: Bearer <token>"`.

### What to ask Claude

- "Search Jobhunt for … in … posted in the last 3 days. Score everything new and show the top five with reasons."
- "Draft an application for the second one." Claude saves it and tells you where to review it. Read the **Gaps Claude found** box and any "check this" warnings.
- "Score the jobs from my AI Research Engineer search." Claude finds the search by role (`list_searches`), pulls only its unscored jobs with descriptions (`jobs_to_score`), and saves the scores (`score_jobs`).
- "Mark that application as sent."
- If a source returned only a short description, open the posting, copy the text, use **Add a posting** in the app, then ask Claude to draft from that.

## Search sources and cost

Searching runs Apify actors under your own Apify account. Open **Settings → Sources** to change which actor each source uses. **Test with 3 results** runs a small search and shows the raw output and what Jobhunt made of it, so you can see problems before spending credit.

| Preset | Pricing (check Apify for current) | Notes |
|---|---|---|
| LinkedIn · curious_coder (default) | Pay per result, roughly $1 per 1,000 jobs | Takes a LinkedIn search URL |
| LinkedIn · fetchclub | Monthly rental plus usage | Full descriptions. Rent it on Apify first. |
| LinkedIn · gopalakrishnan | Very cheap | No description text, so drafts need **Add a posting** |
| Y Combinator · tqm | Pay per result | No keyword search, so Jobhunt filters locally. Max 50 jobs per run. |

Each search costs real money on your Apify account. The default 25 results per source is a few cents. `APIFY_MAX_CHARGE_USD` limits any single run.

## Accounts

- Anyone can create an account on the login page. Each account has its own jobs, searches, profile, applications and sources. Nobody, the owner included, can see another person's jobs or profile.
- Forgot password: the login page says to contact SK. The owner opens **Settings → People**, sees each person's username and counts only, and sets a new password. That signs the person out everywhere, including their Claude connection.
- The owner can also delete an account, which removes everything saved under it. The owner account cannot be deleted.
- **Searches run on the searcher's own Apify account.** Each person adds a token in **Settings → Your Apify account**; it is stored encrypted and never shown again or given to Claude. Only the owner falls back to the server's `APIFY_TOKEN`, so other people can't spend your credit.
- Existing data from before accounts was assigned to the owner on first start.
- `AUTH_SECRET` also encrypts stored Apify tokens. Changing it signs everyone out, disconnects Claude and makes saved tokens unreadable (people re-enter them).

## Security notes

- Passwords are hashed with scrypt. Every Claude connection needs a username and password at approval time, tokens are bound to this app's address, and changing a password revokes them.
- Access tokens last 1 hour, refresh tokens 30 days and rotate. Sign-in attempts are rate limited.
- Claude can read your profile without email, phone or links; those are added by the server to downloads only.
- Job postings are untrusted text. Claude is instructed to treat them as data, but review drafts before using them.
- Your notes on jobs are readable by Claude through `get_job`.

## Run locally

```
npm install
cp .env.example .env.local     # set AUTH_SECRET, APIFY_TOKEN (the default owner is sksiva / sksiva); leave DATABASE_URL blank
npm run dev
```

With no `DATABASE_URL`, an embedded Postgres (PGlite) stores data in `.data/`. Claude can't reach `localhost`; use a tunnel such as Cloudflare Tunnel if you want to test the connector locally.

## Fit scores

Claude does not pick a 0-100 number. For each job it sends structured judgments through `score_jobs` (the requirements, how well your profile proves each, years asked, domain and role match, seniority, location, visa, and how much you would want the job). The server computes:

- **Fit** (0-100): a weighted geometric mean of skills (average coverage and the weakest core requirement), years (a strong paper or shipped project can offset up to 2 years of the ask) and domain/role match.
- **Callback chance**: fit adjusted for competition (applicants, posting age), a referral, visa and location gates, and your callback rate (default 4%).
- **Worth**: callback chance times how much you would want the job, using the cautious end of the fit range. Sort by **Best odds** to rank on it.
- **Effort**: skip, C (quick apply), B (tailored resume) or A (referral and full tailoring).

Set your years override, work authorisation, locations, salary floor, blocked companies and callback rate under **Scoring preferences** on the Profile page. When the profile changes, older scores show **Score outdated**; ask Claude to re-score with `jobs_to_score` and `stale_only`. Set a referral (0-1) on a job and its chance and worth update at once. Claude's evidence for a skill the profile never mentions is capped and flagged. The old `scores` format is still accepted but carries no breakdown.

## Tests

```
npm run test:unit   # scoring model and years parsing, no server needed
npm run build
npm run test:e2e      # set E2E_SKIP_BROWSER=1 to skip the Playwright part
```

This starts a mock Apify server and the built app, then checks the OAuth flow, all 16 tools, search, drafts, DOCX export, two accounts that cannot see each other's data, password change and reset, and the browser UI with Playwright (screenshots go to `test-output/`).

## Known limits

- Tested against a **mock** Apify, not live actors. The curious_coder input names (`urls`, `count`) are not confirmed; if a search errors or returns nothing, use **Test** in Settings and adjust the input there, or switch preset.
- Wellfound is not included; it has no dependable scraper. Add any Apify actor as a custom source in Settings.
- PDF is made with your browser's Print dialog (Save as PDF) from a print view; DOCX is generated on the server.
- Vercel functions time out after 60 s. Searches run asynchronously and are polled, so long scrapes continue in the background.

## Tools Claude gets

`get_profile`, `update_profile`, `search_jobs`, `list_searches`, `get_search`, `list_jobs`, `get_job`, `add_job`, `jobs_to_score`, `score_jobs`, `set_job_state`, `check_draft`, `save_application`, `list_applications`, `get_application`, `set_application_status`.
