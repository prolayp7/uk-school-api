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
and `documents/` as needed and can use `tmp/` for temporary uploads. Files are
stored outside the source tree; do not point this setting at a project
directory. Document downloads use five-minute opaque API links whose hashes
are stored in PostgreSQL. Production must mount this directory as private,
persistent storage shared by API instances and include it in backup/restore
procedures; this deployment uses local filesystem storage, not an object store.

Stripe payment checkout and webhook processing are disabled until both
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in `.env`. Configure
the Stripe webhook for `/api/v1/integrations/payments/stripe/webhook`; the
API verifies the signature against the raw request body.

The server listens on `PORT` (default `3000`). OpenAPI is available at
`/api/v1/docs`; liveness and readiness checks are at
`/api/v1/health/live` and `/api/v1/health/ready`.

## Attendance and access control

Attendance routes are school-scoped and authorize against active role assignments. Leadership, administration, and attendance officers can manage school registers; teachers are restricted to assigned lesson classes. Parent attendance reads require an active portal-enabled pupil contact, and student reads resolve only the pupil profile linked to that account. Parent/student payloads omit staff notes, absence reasons, and authorization status.

The attendance API supports date-based sessions, bulk register marks, school reports by day/week/month, year-group and form breakdowns, academic-year persistent absence, class-scoped teacher summaries, parent/student attendance reads, and audited intervention creation. Absence/lateness changes enqueue durable outbox events; the communications worker currently consumes the `notification.email` message-notification event only. Attendance email/SMS delivery needs its own event handler and channel configuration.

Parent and student timetable reads are available through `/parent/children/:pupilId/timetable` and `/student/timetable`. They return current-year, date-effective slots from the pupil's linked class memberships; parent requests require an active portal-enabled child link and student requests resolve only the signed-in user's pupil profile. This marks the completed parent/student portal foundation for Sprint 3.

The school timetable workspace uses `GET /erp/timetable/options` and
`GET /erp/timetable/slots?effectiveOn=YYYY-MM-DD` to load school-scoped
classes, teachers, and date-effective slots. Superadmin, Headteacher, SLT,
and ADMIN roles can create, update, and delete slots through
`POST /erp/timetable/slots`, `PUT /erp/timetable/slots/:slotId`, and
`DELETE /erp/timetable/slots/:slotId`. Teachers can read slots only for their
assigned classes. Writes validate school-owned class/teacher references and
reject overlapping class, teacher, or room bookings; all writes are audited.

## Finance and fees

School-scoped `/api/v1/erp/finance` routes support charge listing and updates,
invoice-recipient lookup, invoice creation and details, invoice status changes,
payment history, balance reports, and payment refunds. Finance reads and
mutations require `finance.manage`; Superadmin access is implicit. Refunds
must reference a successful provider payment and cannot exceed its
unrefunded amount. Finance reads and writes are audited.

## Census readiness and Single Central Record

`GET /api/v1/erp/census/readiness?censusDate=YYYY-MM-DD` returns readiness
checks for stored pupil details and active enrolment on the selected date.
`GET /api/v1/erp/census/staff-compliance` lists restricted staff compliance
records, and `PUT /api/v1/erp/census/staff/:staffProfileId/compliance`
upserts structured verification dates and DBS status. Census access requires
`census.manage`; SCR access requires `scr.manage`. Headteacher and SLT receive
both permissions, while designated administrators receive them through the
`SCR_ADMIN` role, which Superadmins assign using the school membership-role
workflow. Reads and writes are audited.

The readiness checks are deliberately limited to current pupil data and
enrolment dates. They do not implement every statutory field or collection
rule and do not generate an official DfE census return. SCR records do not
store DBS certificate numbers or free-text sensitive notes. Apply the
versioned `20261013120000_census_scr_records` migration before using the SCR
endpoints.

## Calendar, documents, and communications

Staff can create and list school-scoped calendar events; parents and students
receive only events whose audience and pupil relationship permit access.
Document upload requests are school-authorized, limited to 10 MiB and an
allow-list of file types, and bind the pending upload to its requesting user.
Uploaded bytes stay under `FILE_STORAGE_DIR`; download-link records persist
only a SHA-256 hash and expire after five minutes. Downloads are attachment
responses with `no-store` and `nosniff` headers.

Staff/parent messages, in-app notifications, email-delivery records, and
`notification.email` outbox events are created in one PostgreSQL transaction.
Each API instance runs a small worker that claims jobs with
`FOR UPDATE SKIP LOCKED`, retries delivery with bounded exponential backoff,
and dead-letters after five failed attempts. Outbox event and delivery keys
are unique; SMTP side effects are at-least-once if the process fails after
SMTP acceptance but before the database records success. Leadership/admin
roles can inspect queue age/counts and requeue dead-lettered jobs. The ERP
screens still need to be connected to these APIs and accepted end to end.

## Website CMS and public projections

The Website CMS is part of this ERP API. The website admin panel authenticates
through `POST /api/v1/auth/website-sessions`, which issues a session only to
accounts with an active `SUPER_ADMIN` role. The general
`POST /api/v1/auth/sessions` endpoint remains available for existing ERP and
portal sign-ins. Every `/api/v1/erp/website` CMS route also requires the
authenticated session to have the `SUPER_ADMIN` role, in addition to the
existing school-scope and website permission checks.

Authenticated, school-scoped
`/api/v1/erp/website` routes support page listing, immutable version creation,
review, distinct-author approval, scheduled or immediate publication,
unpublishing, archiving, and retrying cache revalidation. CMS requests require
the active school context (`x-school-id` when the user belongs to multiple
schools); responses are `private, no-store`.

CMS data is stored in the versioned `website_pages` and
`website_page_versions` tables. The `contentType` allow-list defines supported
homepage, page, navigation, news, staff, policy, document, admissions, results,
school-information, and settings content. Unknown content properties are
rejected, content is capped at 64 KiB, and public links must be HTTPS or
site-relative. A draft revision does not replace the currently published
version; published slugs are tracked separately to prevent draft URL changes
from displacing live pages.

Public projections are available under `/api/v1/website` and require an
explicit `?schoolCode=...` selector. They return only allow-listed website
fields; public calendar events must have `audience=public` and no pupil
association. Public responses use `public, max-age=60,
stale-while-revalidate=300`; CMS responses are never publicly cached.

For immediate Website cache invalidation, configure
`WEBSITE_REVALIDATE_URL` and `WEBSITE_REVALIDATE_SECRET` together. The API
POSTs `{schoolCode, paths}` as JSON and sends
`x-website-signature: sha256=<hex HMAC-SHA256 of the exact request body>`.
Both values are optional in local development; without them publication
succeeds with an explicit `not_configured` result and a warning. Both are
required for production, and the URL must use HTTPS. If the Website returns a
non-2xx response or cannot be reached, publication remains committed and the
API returns 503; retry with the authorized
`POST /api/v1/erp/website/pages/{pageId}/revalidate` route. The Website/CMS
frontend still needs to consume these APIs and complete end-to-end acceptance.

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