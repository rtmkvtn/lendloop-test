# One Request record with a lifecycle; a Loan is an approved Request

A Borrower's ask and the resulting Loan are one `requests` row whose `status` moves `pending → approved → returned`, with `declined` and `cancelled` as exits, instead of separate `requests` and `loans` tables. Every status change goes through one transition function (`convex/lib/requestLifecycle.ts`) that checks the allowed-transitions table and, in the same transaction, writes the audit log and queues the Notification. One row means one place for the dates, one history, one id for the activity line and the Reminder key, and no copying between tables that could drift.

## Considered Options

- **Separate `requests` and `loans` tables.** Approval would copy the dates into a new row, and history, Notifications and Reminders would have to follow two ids. It earns nothing unless a Loan gets data a Request doesn't have, such as handover notes or deposits, which are out of scope.
- **One row with a status (chosen).** A Loan is a query, `status = "approved"`, and Overdue is `approved` with `endDate` before today in `APP_TIMEZONE` (index `by_status_endDate`).

## Consequences

- Availability is derived from approved rows when read, never stored.
- Overlap is checked against approved rows when a Request is created and again inside the approval transaction, so two racing approvals can't double-book a Tool. Convex's serialisable mutations make that re-check sufficient.
- Pending Requests may overlap each other, so the Lender can choose between askers.
- Splitting Loans out later means a data migration and changes to every query that reads `requests`.
