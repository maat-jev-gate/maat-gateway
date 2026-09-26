export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export function isPendingApproval(
  approval: { status: ApprovalStatus; expiresAt: string },
  now = Date.now(),
): boolean {
  return approval.status === "pending" && now < Date.parse(approval.expiresAt);
}
