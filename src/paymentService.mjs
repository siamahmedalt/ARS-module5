/**
 * ARS / Module 5 / Feature 2 — Fee Payment Recording & Validation
 * Sprint 2 RED placeholder, deliberately without payment-processing logic.
 *
 * TDD contract (PROPOSED; confirm with team):
 * recordPayment({ actor, payment, storage }) -> Promise<{paymentId, status}>
 *
 * actor: { userId, role: 'REGISTRAR'|'ADMIN' }
 * payment: { studentId, termId, invoiceId, amount_minor, reference, paidAt }
 * amount_minor is integer poisha, NOT a decimal Tk float.
 * storage.withTransaction(async tx => { ... }) is an injectable persistence port.
 *
 * Expected future implementation:
 * - authorize staff; validate BDT amount, invoice ownership and reference;
 * - prevent reference duplicates;
 * - store VALID payment and timestamp atomically;
 * - recompute student/term clearance using Feature 1;
 * - create an audit record;
 * - return {paymentId, status:'VALID'}.
 *
 * DO NOT implement during Sprint 2: these tests should be RED now and
 * will be satisfied during Sprint 3 (GREEN).
 */
export async function recordPayment({ actor, payment, storage }) {
  throw new Error('FEATURE_2_NOT_IMPLEMENTED');
}
