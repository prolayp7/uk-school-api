# uk-school-api

NestJS modular monolith for the UK School ERP and the public Website API.
PostgreSQL is the only V1 stateful infrastructure dependency; Redis and
paid queue/cache services are not required.

## Local setup

Requirements: Node.js 22+, pnpm 9+, and PostgreSQL 15+.

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the restricted
	runtime role. Copy `.env.migration.example` to `.env.migration` and set
	`MIGRATION_DATABASE_URL` to a local migration-owner connection.
3. Generate the Prisma client with `pnpm prisma:generate`. Apply schema changes
	with `pnpm db:migrate:dev` locally or `npx prisma migrate deploy` for a
	versioned deployment. Prisma CLI loads `.env.migration` for migration
	commands; Nest loads only `.env` and continues to use `DATABASE_URL`.
4. Create the runtime role with PostgreSQL's `\password` command and grant it
	only application-table DML. Revoke access to `public._prisma_migrations` and
	set default privileges for future application tables under the migration
	owner.
5. Start the API with `pnpm start:dev`. Keep `.env.migration` out of source
	control and never use its owner connection to run the API.

Set `FILE_STORAGE_DIR` to an absolute directory outside the application
repositories. The API creates feature subdirectories (including `parents/`)
as needed and can use `tmp/` for temporary uploads. Files are stored outside
the source tree; do not point this setting at a project directory.

Stripe payment checkout and webhook processing are disabled until both
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in `.env`. Configure
the Stripe webhook for `/api/v1/integrations/payments/stripe/webhook`; the
API verifies the signature against the raw request body.

The server listens on `PORT` (default `3000`). OpenAPI is available at
`/api/v1/docs`; liveness and readiness checks are at
`/api/v1/health/live` and `/api/v1/health/ready`.

## Attendance and access control

Attendance routes are school-scoped and authorize against active role assignments. Leadership, administration, and attendance officers can manage school registers; teachers are restricted to assigned lesson classes. Parent attendance reads require an active portal-enabled pupil contact, and student reads resolve only the pupil profile linked to that account. Parent/student payloads omit staff notes, absence reasons, and authorization status.

The attendance API supports date-based sessions, bulk register marks, school reports by day/week/month, year-group and form breakdowns, academic-year persistent absence, class-scoped teacher summaries, parent/student attendance reads, and audited intervention creation. Absence/lateness changes enqueue durable outbox events; external email/SMS dispatch requires a separately configured delivery worker.

Parent and student timetable reads are available through `/parent/children/:pupilId/timetable` and `/student/timetable`. They return current-year, date-effective slots from the pupil's linked class memberships; parent requests require an active portal-enabled child link and student requests resolve only the signed-in user's pupil profile. This marks the completed parent/student portal foundation for Sprint 3.

Sensitive module access boundaries and the complete sprint acceptance status are recorded in `docs/sprint.md`.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
```

Readiness requires a working PostgreSQL connection. Do not use production
credentials or production data for local development. Migrations are
versioned under `prisma/migrations/`; never reset a production database.