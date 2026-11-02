import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOutstanding,
  getStudentTermBalance,
  getClearance,
} from '../src/feeClearanceService.mjs';

const term = 'FALL-2026';
const money = (tk, poisha = 0) => tk * 100 + poisha;
const invoice = (id, studentId, termId, amount_minor, status = 'VALID') =>
  ({ invoiceId: id, studentId, termId, amount_minor, status });
const payment = (id, invoiceId, studentId, termId, amount_minor, status = 'VALID') =>
  ({ paymentId: id, invoiceId, studentId, termId, amount_minor, status });

test('M5-T01 | exact outstanding fee balance in BDT including 50 poisha', () => {
  const studentId = 'S101';
  const invoices = [
    invoice('I101', studentId, term, money(15000, 50)),
    invoice('I102', studentId, term, money(5000)),
  ];
  const payments = [payment('P101', 'I101', studentId, term, money(10000))];
  assert.equal(
    calculateOutstanding({ studentId, termId: term, invoices, payments }),
    money(10000, 50), // Tk 10,000.50 outstanding
  );
});

test('M5-T02 | balance is isolated by student AND academic term', () => {
  const invoices = [
    invoice('I201', 'S201', term, money(8500)),
    invoice('I202', 'S201', 'SPRING-2026', money(100000)),
    invoice('I203', 'S202', term, money(50000)),
  ];
  const payments = [
    payment('P201', 'I201', 'S201', term, money(2000)),
    payment('P202', 'I202', 'S201', 'SPRING-2026', money(20000)),
    payment('P203', 'I203', 'S202', term, money(50000)),
  ];
  assert.deepEqual(
    getStudentTermBalance({studentId:'S201',termId:term,invoices,payments}),
    {studentId:'S201',termId:term,outstanding_minor:money(6500),currency:'BDT'},
  );
});

test('M5-S1-T05 | pending and reversed payments cannot reduce fee balance', () => {
  const studentId = 'S301';
  const invoices = [invoice('I301',studentId,term,money(10000))];
  const payments = [
    payment('P301','I301',studentId,term,money(2000),'VALID'),
    payment('P302','I301',studentId,term,money(4000),'PENDING'),
    payment('P303','I301',studentId,term,money(1000),'REVERSED'),
  ];
  assert.equal(
    calculateOutstanding({studentId,termId:term,invoices,payments}),
    money(8000), // only the committed Tk 2,000 is eligible
  );
});

test('M5-T06 | zero outstanding means CLEARED (Tk 0.00)', () => {
  const studentId = 'S401';
  const invoices = [invoice('I401',studentId,term,money(15000))];
  const payments = [payment('P401','I401',studentId,term,money(15000))];
  assert.deepEqual(
    getClearance({studentId,termId:term,invoices,payments}),
    {studentId,termId:term,status:'CLEARED',outstanding_minor:0,currency:'BDT'},
  );
});

test('M5-T07 | positive outstanding means HOLD with precise Tk amount', () => {
  const studentId = 'S501';
  const invoices = [invoice('I501',studentId,term,money(20000))];
  const payments = [payment('P501','I501',studentId,term,money(4750))];
  assert.deepEqual(
    getClearance({studentId,termId:term,invoices,payments}),
    {studentId,termId:term,status:'HOLD',outstanding_minor:money(15250),currency:'BDT'},
  );
});
