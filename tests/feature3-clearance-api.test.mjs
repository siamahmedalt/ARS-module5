/**
 * Sprint 3 - Feature 3 RED tests, to be implemented in Sprint 4.
 * Uses a real ephemeral local HTTP server, but only mocked dependency ports.
 * These are executable API contract tests (NOT a PostgreSQL integration test).
 * Currency is BDT, amounts are integer poisha (100 poisha = Tk 1).
 * Proposed service role/token claims must be confirmed with Teams 1/3.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClearanceServer } from '../src/clearanceApi.mjs';

const path = '/api/v1/fees/clearance/S-101?termId=FALL-2026';
const auth = { Authorization: 'Bearer registration-service-token' };
const invoice = (amount_minor) => ({
  invoiceId: 'INV-101', studentId: 'S-101', termId: 'FALL-2026',
  amount_minor, status: 'VALID',
});
const payment = (amount_minor) => ({
  paymentId: 'PAY-101', invoiceId: 'INV-101', studentId: 'S-101',
  termId: 'FALL-2026', amount_minor, status: 'VALID',
});

async function withServer({ loadLedger, verifyToken } = {}, run) {
  const server = createClearanceServer({
    loadLedger: loadLedger ?? (async () => ({ invoices: [], payments: [] })),
    verifyToken: verifyToken ?? (async (token) =>
      token === 'registration-service-token'
        ? { userId: 'REG-SVC-01', role: 'REGISTRATION_SERVICE' }
        : null),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address();
    const request = async (route = path, headers = auth) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers });
      const body = await response.json();
      return { response, body };
    };
    await run(request);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// M5-S3-T01 / FR-03,FR-04: committed zero balance is CLEARED; exact schema.
test('M5-S3-T01 | registration API returns 200 CLEARED for fully paid BDT invoice', async () => {
  const calls = [];
  await withServer({
    loadLedger: async (keys) => {
      calls.push(keys);
      return { invoices: [invoice(1_000_000)], payments: [payment(1_000_000)] };
    },
  }, async (request) => {
    const { response, body } = await request();
    assert.equal(response.status, 200);
    assert.equal(body.studentId, 'S-101');
    assert.equal(body.termId, 'FALL-2026');
    assert.equal(body.status, 'CLEARED');
    assert.equal(body.outstanding_minor, 0);
    assert.equal(body.currency, 'BDT');
    assert.ok(typeof body.evaluatedAt === 'string' && !Number.isNaN(Date.parse(body.evaluatedAt)));
  });
  assert.deepEqual(calls, [{ studentId: 'S-101', termId: 'FALL-2026' }]);
});

// M5-S3-T02 / FR-03,FR-04: unpaid Tk 15,250 means HOLD.
test('M5-S3-T02 | registration API returns 200 HOLD with Tk 15,250 outstanding', async () => {
  await withServer({
    loadLedger: async () => ({
      invoices: [invoice(2_000_000)], payments: [payment(475_000)],
    }),
  }, async (request) => {
    const { response, body } = await request();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'HOLD');
    assert.equal(body.outstanding_minor, 1_525_000); // Tk 15,250.00
    assert.equal(body.currency, 'BDT');
    assert.equal(body.studentId, 'S-101');
    assert.equal(body.termId, 'FALL-2026');
    assert.equal('invoices' in body, false, 'do not reveal financial ledger rows');
    assert.equal('payments' in body, false);
  });
});

// M5-S3-T03 / FR-04: unknown student/term must not be treated as cleared.
test('M5-S3-T03 | unknown student-term returns 404 NOT_FOUND, not CLEARED', async () => {
  await withServer({
    loadLedger: async () => ({ invoices: [], payments: [] }),
  }, async (request) => {
    const { response, body } = await request('/api/v1/fees/clearance/S-999?termId=SPRING-2027');
    assert.equal(response.status, 404);
    assert.equal(body.error?.code, 'NOT_FOUND');
    assert.notEqual(body.status, 'CLEARED');
    assert.equal('outstanding_minor' in body, false);
  });
});

// M5-S3-T04 / NFR-05: dependency outage is fail-closed and observable.
test('M5-S3-T04 | database dependency outage returns 503, never CLEARED', async () => {
  await withServer({
    loadLedger: async () => { throw new Error('private DB connection detail'); },
  }, async (request) => {
    const { response, body } = await request();
    assert.equal(response.status, 503);
    assert.equal(body.error?.code, 'DEPENDENCY_UNAVAILABLE');
    assert.notEqual(body.status, 'CLEARED');
    assert.equal(JSON.stringify(body).includes('private DB connection detail'), false);
  });
});

// M5-S3-T05 / NFR-04: missing/insufficient role never reaches the ledger.
test('M5-S3-T05 | missing token is 401 and student token is 403; no ledger reads', async () => {
  let reads = 0;
  const loadLedger = async () => { reads++; return { invoices: [invoice(1_000_000)], payments: [] }; };
  const verifyToken = async (token) => {
    if (token === 'student-token') return { userId: 'S-101', role: 'STUDENT' };
    if (token === 'registration-service-token') return { userId: 'REG-SVC-01', role: 'REGISTRATION_SERVICE' };
    return null;
  };
  await withServer({ loadLedger, verifyToken }, async (request) => {
    const noAuth = await request(path, {});
    assert.equal(noAuth.response.status, 401);
    assert.equal(noAuth.body.error?.code, 'UNAUTHENTICATED');
    const studentAuth = await request(path, { Authorization: 'Bearer student-token' });
    assert.equal(studentAuth.response.status, 403);
    assert.equal(studentAuth.body.error?.code, 'FORBIDDEN');
  });
  assert.equal(reads, 0, 'must authorize before querying student ledger');
});
