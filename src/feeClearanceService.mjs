// TDD RED-phase service CONTRACT ONLY. Deliberately no feature implementation.
// Internal amounts: integer poisha. Display only: Tk / BDT (100 poisha = Tk 1).
// Status 'VALID' means committed/eligible; PENDING and REVERSED are excluded.
// Confirm actual status enum, student ID and term ID formats at the contract checkpoint.
export function calculateOutstanding({ studentId, termId, invoices, payments }) {
  throw new Error('NOT_IMPLEMENTED: calculateOutstanding');
}

export function getStudentTermBalance({ studentId, termId, invoices, payments }) {
  throw new Error('NOT_IMPLEMENTED: getStudentTermBalance');
}

export function getClearance({ studentId, termId, invoices, payments }) {
  throw new Error('NOT_IMPLEMENTED: getClearance');
}
