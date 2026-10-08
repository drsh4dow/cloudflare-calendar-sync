# Calendar Sync

A self-hosted Cloudflare Worker that copies events between one Owner's Google
calendars. The Owner signs in with Google; nobody else can.

This README covers setup so far: the Google OAuth client and the `.env` file.

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
  verified this app" warning at sign-in. Click **Advanced**, then continue to
  the app.
- A Google Workspace admin can block unverified apps for their organization.
  An account in such an organization can't sign in or be connected.

The production host is `calendar-sync-prod.<your-subdomain>.workers.dev`,
where the subdomain is your Cloudflare account's workers.dev subdomain.
`bun run deploy` prints the full URL. If you add a custom domain, register
its redirect URI as well. If local development starts on a port other than
1337 because 1337 is taken, register that port's URI too or free the port.

## `.env`

Copy `.env.example` to `.env` and fill in every value. Alchemy deploys them as
Worker secrets.

| Variable               | Value                                       |
| ---------------------- | ------------------------------------------- |
| `OWNER_EMAIL`          | The Google account email allowed to sign in |
| `GOOGLE_CLIENT_ID`     | The OAuth client's ID                       |
| `GOOGLE_CLIENT_SECRET` | The OAuth client's secret                   |
| `BETTER_AUTH_SECRET`   | The output of `openssl rand -base64 32`     |

The Owner's sign-in account is also their first Calendar Account.

`BETTER_AUTH_SECRET` signs sessions and encrypts the stored OAuth tokens.
Back it up. Changing it signs the Owner out and makes the stored tokens
unreadable, so every Calendar Account has to be connected again.

`.env` and `.alchemy/` hold these secrets in plaintext. Both are gitignored;
keep them out of version control.

## Commands

| Task                             | Command                  |
| -------------------------------- | ------------------------ |
| Local development on stage `dev` | `bun run dev`            |
| Deploy stage `prod`              | `bun run deploy`         |
| Destroy stage `prod`             | `bun run destroy`        |
| Checks and tests                 | `vp check` and `vp test` |

[console]: https://console.cloud.google.com/
