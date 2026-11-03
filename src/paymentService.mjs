/**
 * CSE430 / Module 5 / Sprint 3 / Feature 2 - Payment Recording & Validation.
 *
 * Implements the same contract tested in Sprint 2 RED, without modifying tests.
 * Amounts are safe-integer poisha (100 poisha = Tk 1). No floating-point Tk sums.
 * Transactional persistence is abstracted behind storage.withTransaction(...).
 *
 * NOTE: Auth token verification belongs at the HTTP boundary (Module 1 contract).
 * This domain service checks the trusted, previously verified actor role.
 */
import { getClearance } from './feeClearanceService.mjs';

export class PaymentServiceError extends Error {
  constructor(code, httpStatus, message) {
    super(message || code);
    this.name = 'PaymentServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePayment(payment) {
  if (!payment || typeof payment !== 'object') {
    throw new PaymentServiceError('INVALID_PAYMENT', 422, 'Payment information is required');
  }
  if (!Number.isSafeInteger(payment.amount_minor) || payment.amount_minor <= 0) {
    throw new PaymentServiceError('INVALID_AMOUNT', 422, 'Payment must be a positive integer number of poisha');
  }
  for (const field of ['studentId', 'termId', 'invoiceId', 'reference']) {
    if (!nonempty(payment[field])) {
      throw new PaymentServiceError('INVALID_PAYMENT', 422, `${field} must be a nonempty string`);
    }
  }
  if (!nonempty(payment.paidAt) || Number.isNaN(Date.parse(payment.paidAt))) {
    throw new PaymentServiceError('INVALID_DATE', 422, 'paidAt must be a valid ISO 8601 date-time');
  }
}

/**
 * Validates and records one payment. All changes are performed in ONE transaction.
 * A real PostgreSQL adapter must enforce the unique payment reference under
 * concurrency as well as rollback on failure; both are defined in db/schema.sql.
 */
export async function recordPayment({ actor, payment, storage } = {}) {
  // Never allow a STUDENT to reach any write operation, even if UI is bypassed.
  if (!actor || !nonempty(actor.userId) || !['REGISTRAR', 'ADMIN'].includes(actor.role)) {
    throw new PaymentServiceError('FORBIDDEN', 403, 'Only authorized staff may record payments');
  }
  validatePayment(payment);
  if (!storage || typeof storage.withTransaction !== 'function') {
    throw new TypeError('storage.withTransaction is required');
  }

  try {
    return await storage.withTransaction(async (tx) => {
      const alreadyRecorded = await tx.getPaymentByReference(payment.reference);
      if (alreadyRecorded) {
        throw new PaymentServiceError(
          'DUPLICATE_PAYMENT_REFERENCE', 409, 'Payment reference has already been used',
        );
      }

      const invoice = await tx.getInvoice(payment.invoiceId);
      if (!invoice) {
        throw new PaymentServiceError('INVOICE_NOT_FOUND', 404, 'Invoice was not found');
      }
      if (invoice.studentId !== payment.studentId || invoice.termId !== payment.termId) {
        throw new PaymentServiceError('INVOICE_MISMATCH', 422, 'Invoice does not belong to student and term');
      }
      if (invoice.status !== 'VALID') {
        throw new PaymentServiceError('INVOICE_NOT_ACTIVE', 422, 'Invoice is not valid for payment');
      }

      const stored = await tx.insertPayment({ ...payment, status: 'VALID' });
      const invoices = await tx.listInvoicesForStudentTerm(payment.studentId, payment.termId);
      const payments = await tx.listPaymentsForStudentTerm(payment.studentId, payment.termId);
      const clearance = getClearance({
        studentId: payment.studentId, termId: payment.termId, invoices, payments,
      });
      await tx.saveClearance(clearance);
      await tx.appendAudit({
        action: 'PAYMENT_RECORDED',
        actorId: actor.userId,
        paymentId: stored.paymentId,
        studentId: payment.studentId,
        termId: payment.termId,
        invoiceId: payment.invoiceId,
        amount_minor: payment.amount_minor,
        recordedAt: payment.paidAt,
      });
      return { paymentId: stored.paymentId, status: 'VALID' };
    });
  } catch (error) {
    // A database unique constraint protects against concurrent requests that
    // both pass the initial duplicate-reference lookup.
    if (error?.code === '23505' && error?.constraint === 'uq_payment_reference') {
      throw new PaymentServiceError('DUPLICATE_PAYMENT_REFERENCE', 409, 'Payment reference has already been used');
    }
    throw error;
  }
}
