# LendLoop

A neighbourhood board where people lend tools to each other and borrow them for a date range.

## Language

**Tool**:
A physical item a member offers for lending, with a name, category, condition and short description.
_Avoid_: Item, listing (except in "My listings", the view of one's own Tools)

**Member**:
A signed-in person using LendLoop; every Member can be both a Lender and a Borrower. Stored as a `users` row; a Member who isn't an Admin has `role: "user"`.
_Avoid_: User, account, customer

**Admin**:
A Member with moderation powers: removes any Tool, sees every Loan, grants Trusted Lender, runs reminders and retries failed automations. Granted only from the command line.
_Avoid_: Moderator, superuser

**Trusted Lender**:
A badge an Admin grants to a Lender, shown to signed-in Members; it changes nothing else.
_Avoid_: Verified, trusted user

**Category**:
The fixed kind of a Tool: power tools, hand tools, garden, kitchen, camping, cleaning or other.
_Avoid_: Type, tag

**Condition**:
The Lender's statement of a Tool's wear: new, good, fair or worn.
_Avoid_: Quality, state

**Available**:
A Tool that is not removed and has no unreturned Loan that has started, whether it covers today or is Overdue.
_Avoid_: Free, in stock

**Lender**:
The member who owns a Tool and decides on Requests for it.
_Avoid_: Owner, host

**Borrower**:
The member who asks to borrow someone else's Tool.
_Avoid_: Renter, requester

**Request**:
A Borrower's ask to borrow a Tool for a date range. It is pending, then approved, declined or cancelled; an approved Request ends as returned. A pending Request is auto-declined when its Tool is removed.
_Avoid_: Booking, reservation, borrow request

**Loan**:
A Request in the approved state: the Tool is committed to the Borrower for that date range.
_Avoid_: Rental, checkout

**Overdue**:
A Loan whose end date has passed without being marked returned.
_Avoid_: Late, expired

**Notification**:
An email telling a Member that a Request they are part of was created or changed status, or telling a Lender that an Admin removed their Tool.
_Avoid_: Alert, message

**Reminder**:
An email telling a Borrower that their Loan is Overdue; at most one per Loan per day.
_Avoid_: Nudge, overdue notice

**Reminder run**:
One pass of the n8n reminder workflow, daily at 09:00 in `APP_TIMEZONE` or started by an Admin with "Run reminders now", that sends each Overdue Borrower their Reminder for the day.
_Avoid_: Reminder job, batch

**Activity line**:
The latest Notification or Reminder of a Request, in plain language under the Tool name, red when it failed (for example "Reminder sent 2 days ago").
_Avoid_: Status line, log

**Workflow error**:
A failure of an automation run as a whole, rather than of one email: a failed n8n execution, a missed Reminder run, or a Reminder run that couldn't be started. Admins see it in Automation health.
_Avoid_: Incident
