import assert from "node:assert/strict";
import { test } from "node:test";
import { isPendingApproval } from "../server/approval";

const expiresAt = "2026-09-26T12:03:00.000Z";
const beforeExpiry = Date.parse("2026-09-26T12:02:59.999Z");
const atExpiry = Date.parse(expiresAt);

test("a cancelled approval cannot release payment when World returns later", () => {
  assert.equal(isPendingApproval({ status: "pending", expiresAt }, beforeExpiry), true);
  assert.equal(isPendingApproval({ status: "cancelled", expiresAt }, beforeExpiry), false);
});

test("an expired or completed approval cannot release payment", () => {
  assert.equal(isPendingApproval({ status: "pending", expiresAt }, atExpiry), false);
  assert.equal(isPendingApproval({ status: "approved", expiresAt }, beforeExpiry), false);
  assert.equal(isPendingApproval({ status: "rejected", expiresAt }, beforeExpiry), false);
});
