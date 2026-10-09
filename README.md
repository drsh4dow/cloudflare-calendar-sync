# Calendar Sync

A self-hosted Cloudflare Worker that keeps one Owner's Google calendars aware
of each other. You deploy it to your own Cloudflare account, sign in with
Google, and connect each Google account that holds a Calendar. Only the email
in `OWNER_EMAIL` can sign in.

A Sync Rule copies events from a Source Calendar into a Target Calendar in one
of two Modes:

- **Private Mode**: the Copy shows only busy time under a title set on the
  Sync Rule, "Busy" by default.
- **Transparent Mode**: the Copy shows the event's title, time, location,
  description, and conference link.

Copies never carry attendees or reminders. For two-way syncing, create two
Sync Rules; the create dialog offers the reverse rule as a shortcut.

A Run brings every Sync Rule's Copies in line with its Source Events from the
start of today to 60 days ahead. Cron starts a Run every five minutes, and
**Run now** on the dashboard starts the same Run. A Run skips events you
declined, events marked free, and working-location events. Out-of-office and
focus time are copied as busy. All-day events are copied only when the Sync
Rule's all-day toggle is on. When the Target Calendar already holds the same
meeting and you haven't declined it there, a Run makes no Copy of it. Copies
are never copied again, so two Sync Rules in opposite directions can't loop.

The system only creates, changes, and deletes its own Copies. A Copy that has
ended is never touched again.

## Requirements

- A Cloudflare account on the Workers Paid plan. Workers Free allows 10 ms of
  CPU time and 50 subrequests per cron invocation, and a first Run can make
  hundreds of Google Calendar writes.
- Node.js 24 and Bun. Alchemy, which deploys the Worker, runs under Node; Bun
  installs packages and runs the scripts.
- A Google Cloud project for the OAuth client.

Clone the repository and install its packages:

```sh
git clone https://github.com/drsh4dow/cloudflare-calendar-sync.git
cd cloudflare-calendar-sync
bun install
```

## Google OAuth client

Create the client once in the [Google Cloud console][console]. One client
serves both local development and production.

1. Create or pick a Google Cloud project.
2. Under **APIs & Services > Library**, enable the **Google Calendar API**.
3. Open **Google Auth platform**. If it says it isn't configured yet, click
   **Get started**, enter an app name and support email, and choose
   **External** as the audience.
4. Under **Data Access > Add or remove scopes**, add:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
5. Under **Audience**, click **Publish app** so the publishing status is
   **In production**. Don't submit the app for verification.
6. Under **Clients**, create a client of type **Web application** with these
   authorized redirect URIs:
   - `http://localhost:1337/api/auth/callback/google` for local development
   - `https://calendar-sync-prod.<your-subdomain>.workers.dev/api/auth/callback/google`
     for production
7. Copy the client ID and client secret into `.env` (next section). Google
   shows the secret only once, when the client is created.

Why these settings:

- In **Testing** status, Google expires refresh tokens after seven days, and
  syncing stops until you sign in again. **In production** avoids that.
- Calendar scopes need Google's verification, which a personal instance
  doesn't need. The app stays unverified, so Google shows a "Google hasn't
  verified this app" warning at every sign-in and every account you connect.
  Click **Advanced**, then continue to the app.
- A Google Workspace admin can block unverified apps for their organization.
  An account in such an organization can't sign in or be connected.

The production host is `calendar-sync-prod.<your-subdomain>.workers.dev`,
where the subdomain is your Cloudflare account's workers.dev subdomain.
`bun run deploy` prints the full URL. With a custom domain (`CUSTOM_DOMAIN`
below), also register `https://<custom-domain>/api/auth/callback/google`.
If local development starts on a port other than
1337 because 1337 is taken, register that port's URI too or free the port.

## `.env`

Copy `.env.example` to `.env` and fill in every value. Alchemy deploys the
four secrets below as Worker secrets.

| Variable               | Value                                       |
| ---------------------- | ------------------------------------------- |
| `OWNER_EMAIL`          | The Google account email allowed to sign in |
| `GOOGLE_CLIENT_ID`     | The OAuth client's ID                       |
| `GOOGLE_CLIENT_SECRET` | The OAuth client's secret                   |
| `BETTER_AUTH_SECRET`   | The output of `openssl rand -base64 32`     |

To serve the app on your own hostname, set `CUSTOM_DOMAIN`, for example
`calendar.example.com`. Its zone must be on Cloudflare in the same account;
the deploy creates the DNS record and certificate. The workers.dev URL keeps
working.

The Owner's sign-in account is also their first Calendar Account.

`BETTER_AUTH_SECRET` signs sessions and encrypts the stored OAuth tokens.
Back it up. Changing it signs the Owner out and makes the stored tokens
unreadable, so every Calendar Account has to be connected again.

`.env` and `.alchemy/` hold these secrets in plaintext. Both are gitignored;
keep them out of version control and off shared machines.

## Cloudflare login

Alchemy deploys with the Cloudflare credentials stored in an Alchemy profile
under `~/.alchemy/`. Log in once:

```sh
bun run alchemy profile edit --add Cloudflare
```

Choose **OAuth**, then **Basic Scopes**, and approve the access in the browser
window that opens. If your login has several Cloudflare accounts, pick the one
that should run the instance.

Commands use the profile named `default`. To use another profile, set
`ALCHEMY_PROFILE` in `.env`.

If a deploy fails with "Cloudflare OAuth scopes need to be selected", the
profile lists Cloudflare without a finished login. Log in again:

```sh
bun run alchemy profile edit --reconfigure Cloudflare
```

## Deploy

```sh
bun run deploy
```

The deploy shows the planned changes and asks for confirmation. It creates the
Worker `calendar-sync-prod` with its five-minute cron, the D1 database
`calendar-sync-prod`, and the four secrets, applies the database migrations,
and prints the URL. Open it and sign in with the `OWNER_EMAIL` account.

On the dashboard, connect your other Google accounts with **Connect Google
account**, then create Sync Rules. A Source Calendar can be any Calendar an
account can read, including calendars shared with you read-only. A Target
Calendar must be one the account can write. Click **Run now** to see the first
Copies right away; otherwise the next cron Run makes them within five minutes.

To update, pull the new code and run `bun run deploy` again. A deploy with no
code or configuration change does nothing. `bun run deploy --force` uploads
the Worker again anyway. Deploys keep the database.

## Local development

```sh
bun run dev
```

This serves stage `dev` on `http://localhost:1337`, with a local database
under `.alchemy/` and no Cloudflare resources. It still calls the real Google
APIs, so Sync Rules you create in `dev` write real Copies into your
Calendars. Delete them before you stop using `dev`.

The cron doesn't fire locally. Start a scheduled Run with:

```sh
curl http://localhost:1337/cdn-cgi/handler/scheduled
```

The scripts fix the stages: `bun run dev` always uses `dev`, and
`bun run deploy` and `bun run destroy` always use `prod`. Never run `dev`
against `prod`.

## Remove an instance

1. In the dashboard, delete every Sync Rule. Each deletion deletes the rule's
   Copies that haven't ended. The destroy command never calls Google, so
   Copies left at this point stay in your Calendars.
2. Run `bun run destroy`. It deletes the Worker, the D1 database with the
   stored OAuth tokens, and the secrets.

Disconnecting a Calendar Account also deletes the Copies its Calendars
produced in other accounts that haven't ended. Copies inside the disconnected
account stay for you to delete.

## Commands

| Task                              | Command                     |
| --------------------------------- | --------------------------- |
| Deploy stage `prod`               | `bun run deploy`            |
| Redeploy unchanged code to `prod` | `bun run deploy --force`    |
| Local development on stage `dev`  | `bun run dev`               |
| Destroy stage `prod`              | `bun run destroy`           |
| Any other Alchemy command         | `bun run alchemy <command>` |
| Checks and tests                  | `vp check` and `vp test`    |

[console]: https://console.cloud.google.com/
