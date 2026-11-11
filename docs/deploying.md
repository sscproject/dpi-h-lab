# Deploying DPI-H Lab

The official instance, **[dpih.fhirlab.net](https://dpih.fhirlab.net)**, is hosted by the authors, and sessions for countries and regions run there. If you're thinking of hosting your own copy, please [open an issue](https://github.com/sscproject/dpi-h-lab/issues/new/choose) first: we can usually set up a session for you instead, and we'd like to know where the tool is used.

Any copy must keep the [NOTICE](../NOTICE) file and show the authors' credit to its users (see the README's "Licence and attribution").

## What a deployment needs

- A small Linux server with Docker Compose. One server with 2 GB of memory handled a 200-person load test comfortably.
- A TLS proxy in front (for example Caddy with Let's Encrypt). Keep the app and database ports private to the server.
- The app container, built from this repository's `Dockerfile`, with these settings:
  - `NODE_ENV=production`
  - `JWT_SECRET`: at least 32 random characters (the server refuses to start otherwise)
  - `DATABASE_URL`: the PostgreSQL connection
  - `PUBLIC_URL`: the site's public address, used in join links and QR codes
  - `TRUST_PROXY=1` with one proxy in front
- PostgreSQL 16, with regular backups stored off the server.

Database migrations run automatically when the server starts. On first start, the server prints a one-time setup code in its log for creating the first Super Admin account.

See [.env.example](../.env.example) for every setting, and [architecture.md](architecture.md) for how the parts fit together.
