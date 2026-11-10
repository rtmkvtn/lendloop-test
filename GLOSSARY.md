# LendLoop

A neighbourhood board where people lend tools to each other and borrow them for a date range.

## Language

**Tool**:
A physical item a member offers for lending, with a name, category, condition and short description.
_Avoid_: Item, listing (except in "My listings", the view of one's own Tools)

**Member**:
A signed-in person using LendLoop; every Member can be both a Lender and a Borrower.
_Avoid_: User, account, customer

**Admin**:
A Member with moderation powers: removes any Tool, sees every Loan, grants Trusted Lender.
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
A Tool that is not removed and has no unreturned Loan covering today.
_Avoid_: Free, in stock

**Lender**:
The member who owns a Tool and decides on Requests for it.
_Avoid_: Owner, host

**Borrower**:
The member who asks to borrow someone else's Tool.
_Avoid_: Renter, requester

**Request**:
A Borrower's ask to borrow a Tool for a date range. It is pending, then approved, declined or cancelled; an approved Request ends as returned.
_Avoid_: Booking, reservation, borrow request

**Loan**:
A Request in the approved state: the Tool is committed to the Borrower for that date range.
_Avoid_: Rental, checkout

**Overdue**:
A Loan whose end date has passed without being marked returned.
_Avoid_: Late, expired

**Notification**:
An email telling a Member that a Request they are part of was created or changed status.
_Avoid_: Alert, message

**Reminder**:
An email telling a Borrower that their Loan is Overdue; at most one per Loan per day.
_Avoid_: Nudge, overdue notice
