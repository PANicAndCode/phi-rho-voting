# Phi Sigma Rho Election Center

This is a static GitHub Pages friendly election site for Phi Sigma Rho. It includes:

- President-controlled election flow for speeches, Q&A, discussion, and opening or closing ballots
- Position and candidate setup for the chapter officer slate
- A ranked ballot flow for Standards Board with four seats
- President-only result review
- A Supabase backend option so votes sync across devices and stay hidden from the rest of the chapter
- A local browser-only demo mode when Supabase is not configured

## Files

- [index.html](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/index.html)
- [styles.css](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/styles.css)
- [js/app.js](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/js/app.js)
- [js/storage.js](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/js/storage.js)
- [js/constants.js](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/js/constants.js)
- [config.js](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/config.js)
- [supabase/schema.sql](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/supabase/schema.sql)

## Supabase setup

1. Create a new Supabase project.
2. Open the SQL editor and run the contents of [supabase/schema.sql](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/supabase/schema.sql).
3. In Supabase Auth, enable email and password sign-in.
4. Decide whether members should confirm their emails. If you want a smoother launch, disable email confirmation during setup.
5. Open [config.js](/Users/jillianflaspohler/Downloads/Roblox- Burger/Phi Rho Voting/config.js) and paste in:

```js
window.PHI_RHO_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",
};
```

6. Open the site, create the president account, then promote that account in the Supabase SQL editor:

```sql
update public.profiles
set role = 'president'
where email = 'president-email@example.com';
```

7. Sign back in with that account. The President Console will unlock and that account will be able to control the floor and review results.

## GitHub Pages deployment

1. Create a GitHub repository and upload this folder.
2. Commit `config.js` only if you are comfortable exposing your Supabase URL and anon key in the repository.
3. In GitHub, open `Settings > Pages`.
4. Set the deploy source to your main branch and the root folder.
5. GitHub Pages will host the frontend, while Supabase handles auth, storage, and row-level security.

If you do not want to commit your real keys, keep a private branch with the real `config.js`, or host a private copy for chapter use.

## Election rules currently reflected in the app

- Speech timer defaults to 3 minutes.
- Q&A timer defaults to 7 minutes.
- Discussion timer defaults to 10 minutes.
- Standard officer ballots use simple majority tallying.
- Unopposed exec positions switch to approve, deny, or abstain and show whether the 3/4 affirmative threshold is met.
- Standards Board uses a ranked ballot and currently tallies rankings as 4, 3, 2, 1 points.

## Important assumptions

- The app treats these offices as exec for the unopposed 3/4 rule: President, VP-I, VP-F, VP-ME, VP-R, Social Chair, and Secretary.
- Standards Board counting is implemented as a weighted ranked tally because the bylaws snippet describes ranking but does not specify the exact counting method.
- Consecutive-term limits are shown as reminders in the interface, but the app does not enforce prior-term eligibility automatically because it does not track officer history.

## Security notes

- GitHub Pages alone cannot securely store chapter ballots or hide results. That is why the real multi-device mode depends on Supabase.
- The public board can read election state so chapter members can see the live office, timer, and current phase without opening results.
- Non-president signed-in users can read only their own ballot rows.
- President accounts can read all ballots for tallying.
- Supabase project owners can still inspect database rows from the dashboard. If you need stronger secrecy than president-only app access, you would need a more advanced ballot design.

## Local preview

You can preview the site locally by serving the folder with Python:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
