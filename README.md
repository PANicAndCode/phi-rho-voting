# Phi Sigma Rho Election Center

This is a static GitHub Pages friendly election site for Phi Sigma Rho. It includes:

- Member accounts that use only a name and password
- A dedicated president sign-in button tied to `president.psr.rho@gmail.com`
- President-controlled speeches, Q&A, discussion, and ballot opening or closing
- Position and candidate setup for the chapter officer slate
- Standards Board ranked ballots for four seats
- President-only results, member online status, role promotion, and kick-out controls
- A local browser-only demo mode when Supabase is not configured

## Files

- [index.html](/Users/jillianflaspohler/Downloads/Phi Rho Voting/index.html)
- [styles.css](/Users/jillianflaspohler/Downloads/Phi Rho Voting/styles.css)
- [js/app.js](/Users/jillianflaspohler/Downloads/Phi Rho Voting/js/app.js)
- [js/storage.js](/Users/jillianflaspohler/Downloads/Phi Rho Voting/js/storage.js)
- [js/constants.js](/Users/jillianflaspohler/Downloads/Phi Rho Voting/js/constants.js)
- [config.js](/Users/jillianflaspohler/Downloads/Phi Rho Voting/config.js)
- [supabase/schema.sql](/Users/jillianflaspohler/Downloads/Phi Rho Voting/supabase/schema.sql)

## Supabase setup

1. Create a new Supabase project.
2. Open the SQL editor and run [supabase/schema.sql](/Users/jillianflaspohler/Downloads/Phi Rho Voting/supabase/schema.sql).
3. Open [config.js](/Users/jillianflaspohler/Downloads/Phi Rho Voting/config.js) and paste in:

```js
window.PHI_RHO_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",
};
```

4. The schema now creates or resets the fixed president account automatically. The default president password is `P3ngu!n84`.
5. If your project already had the older schema, run [supabase/reset-president-account.sql](/Users/jillianflaspohler/Downloads/Phi Rho Voting/supabase/reset-president-account.sql).

6. Open the site. Members can create accounts immediately with their name and password.
7. The president signs in with the dedicated president button and the password from step 4.

## How access works

- Members create an account with just a name and password.
- There is no email verification and no confirmation step.
- The president button always targets the member record whose `contact_email` is `president.psr.rho@gmail.com`.
- Any member granted the `president` role can also reach the president console after signing in with their own name and password.
- The president console can:
  - see which members are currently online
  - promote members into president access
  - remove president access from other members
  - kick out active member sessions
  - run the election flow and view results

## GitHub Pages deployment

1. Push this folder to GitHub.
2. In GitHub, open `Settings > Pages`.
3. Set the deploy source to the `main` branch and the root folder.
4. GitHub Pages will host the frontend, while Supabase stores members, sessions, votes, and election state.

## Election rules currently reflected in the app

- Speech timer defaults to 3 minutes.
- Q&A timer defaults to 7 minutes.
- Discussion timer defaults to 10 minutes.
- Standard officer ballots use simple majority tallying.
- Unopposed exec positions switch to approve, deny, or abstain and show whether the 3/4 affirmative threshold is met.
- Standards Board uses a ranked ballot and currently tallies rankings as 4, 3, 2, 1 points.

## Important assumptions

- Member names are treated as unique login names. If two sisters share the same name, use a distinct version such as a middle initial.
- The app treats these offices as exec for the unopposed 3/4 rule: President, VP-I, VP-F, VP-ME, VP-R, Social Chair, and Secretary.
- Standards Board counting is implemented as a weighted ranked tally because the bylaws snippet describes ranking but does not specify the exact counting formula.
- Consecutive-term limits are shown as reminders in the interface, but the app does not enforce officer-history eligibility automatically.

## Security notes

- GitHub Pages alone cannot securely store chapter ballots or hide results. That is why the real multi-device mode depends on Supabase.
- This version uses custom chapter accounts and signed session tokens instead of Supabase Auth email login.
- Direct table access is blocked by row-level security. The site talks to Supabase through SQL RPC functions.
- Non-president signed-in users can access only their own vote through the app.
- President accounts can review tallies and manage member sessions.
- Supabase project owners can still inspect database rows from the dashboard.

## Local preview

You can preview the site locally by serving the folder with Python:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
