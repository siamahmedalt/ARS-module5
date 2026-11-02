import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPayment } from '../src/paymentService.mjs';

// Feature 2's proposed repository/transaction port. In-memory fake is TEST CODE,
// not a working payment feature or a substitute for PostgreSQL integration.
function fixture({ invoices = [], payments = [], clearances = [], auditEvents = [] } = {}) {
  const state = {
    invoices: structuredClone(invoices),
    payments: structuredClone(payments),
    clearances: structuredClone(clearances),
    auditEvents: structuredClone(auditEvents),
  };
  let transactionCount = 0;
  const tx = {
    getInvoice: async (id) => state.invoices.find((i) => i.invoiceId === id) ?? null,
    getPaymentByReference: async (ref) => state.payments.find((p) => p.reference === ref) ?? null,
    insertPayment: async (entry) => {
      const stored = { paymentId: `PAY-${String(state.payments.length + 1).padStart(4, '0')}`, ...entry };
      state.payments.push(stored);
      return structuredClone(stored);
    },
    listInvoicesForStudentTerm: async (s, t) => state.invoices.filter((i) => i.studentId === s && i.termId === t),
    listPaymentsForStudentTerm: async (s, t) => state.payments.filter((p) => p.studentId === s && p.termId === t),
    saveClearance: async (row) => {
      state.clearances = state.clearances.filter((c) => !(c.studentId === row.studentId && c.termId === row.termId));
      state.clearances.push(structuredClone(row));
    },
    appendAudit: async (entry) => { state.auditEvents.push(structuredClone(entry)); },
  };
  return {
    state,
    storage: { withTransaction: async (action) => { transactionCount++; return action(tx); } },
    getTransactionCount: () => transactionCount,
  };
}

const termId = 'FALL-2026';
const registrar = { userId: 'R-101', role: 'REGISTRAR' };
const invoice = (invoiceId, studentId = 'S-101', term = termId, amount_minor = 1_000_000) =>
  ({ invoiceId, studentId, termId: term, amount_minor, status: 'VALID' });
const validPayment = (paymentId, reference, amount_minor = 500_000) => ({
  paymentId, invoiceId: 'INV-101', studentId: 'S-101', termId,
  amount_minor, reference, paidAt: '2026-10-29T10:00:00.000Z', status: 'VALID',
});
const payment = (values = {}) => ({
  studentId: 'S-101', termId, invoiceId: 'INV-101',
  amount_minor: 250_050, reference: 'BANK-2026-0002',
  paidAt: '2026-10-29T11:30:00.000Z', ...values,
});

// M5-T03 / FR-02, FR-03, FR-10: success path verifies persistence,
// accurate balance after payment (Tk 2,499.50), and audit evidence.
test('M5-T03 | registrar records Tk 2,500.50; ledger, clearance, and audit update', async () => {
  const f = fixture({
    invoices: [invoice('INV-101')],
    payments: [validPayment('PAY-0001', 'BANK-2026-0001')],
  });
  const response = await recordPayment({ actor: registrar, payment: payment(), storage: f.storage });
  assert.deepEqual(response, { paymentId: 'PAY-0002', status: 'VALID' });
  assert.equal(f.getTransactionCount(), 1, 'payment and related updates must share a transaction');
  assert.equal(f.state.payments.length, 2);
  assert.deepEqual(f.state.payments[1], {
    paymentId: 'PAY-0002', ...payment(), status: 'VALID',
  });
  assert.deepEqual(f.state.clearances, [{
    studentId: 'S-101', termId, status: 'HOLD', outstanding_minor: 249_950, currency: 'BDT',
  }]);
  assert.equal(f.state.auditEvents.length, 1, 'payment must create an audit event');
  assert.equal(f.state.auditEvents[0].action, 'PAYMENT_RECORDED');
  assert.equal(f.state.auditEvents[0].actorId, 'R-101');
  assert.equal(f.state.auditEvents[0].paymentId, 'PAY-0002');
});

// M5-T04: same reference must never post a second credit.
test('M5-T04 | duplicate payment reference is rejected with no ledger change', async () => {
  const f = fixture({
    invoices: [invoice('INV-101')],
    payments: [validPayment('PAY-0001', 'BANK-2026-0001')],
  });
  const before = structuredClone(f.state);
  await assert.rejects(
    recordPayment({actor:registrar, payment:payment({ reference:'BANK-2026-0001' }), storage:f.storage}),
    (error) => error?.code === 'DUPLICATE_PAYMENT_REFERENCE' && error?.httpStatus === 409,
  );
  assert.deepEqual(f.state, before, 'duplicate must not change payment, clearance or audit data');
});

// M5-T05 / NFR-04: role checks must be server-side, not React-only.
test('M5-T05 | STUDENT cannot record payments even with valid invoice data', async () => {
  const f = fixture({invoices:[invoice('INV-101')]});
  const before = structuredClone(f.state);
  await assert.rejects(
    recordPayment({actor:{userId:'S-101',role:'STUDENT'},payment:payment(),storage:f.storage}),
    (error) => error?.code === 'FORBIDDEN' && error?.httpStatus === 403,
  );
  assert.deepEqual(f.state, before, 'forbidden action must not mutate records');
});

// M5-S2-T01 / FR-02: zero and negative amounts invalid; money is integer poisha.
test('M5-S2-T01 | zero and negative Tk amounts are rejected without writes', async () => {
  const f = fixture({invoices:[invoice('INV-101')]});
  const before = structuredClone(f.state);
  for (const amount_minor of [0, -100]) {
    await assert.rejects(
      recordPayment({actor:registrar,payment:payment({amount_minor}),storage:f.storage}),
      (error) => error?.code === 'INVALID_AMOUNT' && error?.httpStatus === 422,
      `amount_minor=${amount_minor} must be rejected`,
    );
  }
  assert.deepEqual(f.state, before, 'invalid amount must not mutate records');
});

// M5-S2-T02 / FR-02: invoice must actually belong to request student and term.
test('M5-S2-T02 | invoice owned by another student is rejected without writes', async () => {
  const f = fixture({invoices:[invoice('INV-101','S-999',termId)]});
  const before = structuredClone(f.state);
  await assert.rejects(
    recordPayment({actor:registrar,payment:payment(),storage:f.storage}),
    (error) => error?.code === 'INVOICE_MISMATCH' && error?.httpStatus === 422,
  );
  assert.deepEqual(f.state, before, 'mismatched invoice must not mutate records');
});
