/**
 * ARS Module 5 / Feature 1 — Student Fee Balance & Clearance Engine.
 * Sprint 2 GREEN implementation of the UNCHANGED Sprint 1 five-test contract.
 *
 * All monetary inputs and outputs use integer poisha (100 poisha = Tk 1).
 * Only VALID invoices and payments participate in calculations.
 * A payment must belong to a VALID invoice for the requested student/term.
 * This is a domain-only service: no HTTP, React, or database calls.
 *
 * Business assumptions requiring confirmation:
 * - VALID/PENDING/REVERSED status vocabulary is provisional.
 * - If eligible invoices do not exist, throw instead of assuming CLEARED.
 * - Overpayment is returned as zero outstanding; refund/credit policy TBD.
 */

function requireId(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function requireAmount(value, source) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${source}.amount_minor must be a non-negative safe integer (poisha)`);
  }
}

function checkedAdd(total, value) {
  const sum = total + value;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('Fee total exceeds JavaScript safe-integer range');
  }
  return sum;
}

/** Return non-negative outstanding balance in integer poisha. */
export function calculateOutstanding({ studentId, termId, invoices, payments }) {
  requireId(studentId, 'studentId');
  requireId(termId, 'termId');
  if (!Array.isArray(invoices) || !Array.isArray(payments)) {
    throw new TypeError('invoices and payments must be arrays');
  }

  const validInvoices = invoices.filter((item) =>
    item?.studentId === studentId &&
    item?.termId === termId &&
    item?.status === 'VALID'
  );

  // Unknown student/term must never be incorrectly classified as cleared.
  if (validInvoices.length === 0) {
    throw new Error('NO_VALID_INVOICE_FOR_STUDENT_TERM');
  }

  const eligibleInvoiceIds = new Set();
  let totalCharges = 0;
  for (const row of validInvoices) {
    requireId(row.invoiceId, 'invoice.invoiceId');
    requireAmount(row.amount_minor, 'invoice');
    if (eligibleInvoiceIds.has(row.invoiceId)) {
      throw new Error(`DUPLICATE_INVOICE_ID: ${row.invoiceId}`);
    }
    eligibleInvoiceIds.add(row.invoiceId);
    totalCharges = checkedAdd(totalCharges, row.amount_minor);
  }

  let totalValidPayments = 0;
  for (const row of payments) {
    // Ignore pending, reversed, other-student/term, and mismatched-invoice payments.
    if (
      row?.status !== 'VALID' ||
      row.studentId !== studentId ||
      row.termId !== termId ||
      !eligibleInvoiceIds.has(row.invoiceId)
    ) {
      continue;
    }
    requireAmount(row.amount_minor, 'payment');
    totalValidPayments = checkedAdd(totalValidPayments, row.amount_minor);
  }

  // Outstanding due cannot be negative. Credits/refunds belong to a later policy.
  return Math.max(0, totalCharges - totalValidPayments);
}

/** Return fee balance data for one student and one academic term. */
export function getStudentTermBalance({ studentId, termId, invoices, payments }) {
  const outstanding_minor = calculateOutstanding({
    studentId, termId, invoices, payments,
  });
  return { studentId, termId, outstanding_minor, currency: 'BDT' };
}

/** Return registration clearance result; no database writes or mutable state. */
export function getClearance({ studentId, termId, invoices, payments }) {
  const { outstanding_minor } = getStudentTermBalance({
    studentId, termId, invoices, payments,
  });
  return {
    studentId,
    termId,
    status: outstanding_minor === 0 ? 'CLEARED' : 'HOLD',
    outstanding_minor,
    currency: 'BDT',
  };
}
