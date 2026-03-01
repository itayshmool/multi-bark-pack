export type PolicyAction = 'auto_approve' | 'require_approval' | 'block';

export interface PolicyRule {
  tool: string;
  pattern?: string;
  action: PolicyAction;
}

export interface ApprovalPolicy {
  defaultAction: PolicyAction;
  approvalTimeout: number;
  rules: PolicyRule[];
  barkignore: string[];
}

export interface ApprovalRequest {
  messageId: string;
  tool: string;
  args: string;
  action: 'require_approval' | 'block';
  heldOutput: string;
  heldLiveMsgId: string;
  replyToId: string | null;
  requestedAt: number;
  adapterName: string;
}

export interface ViolationRecord {
  tool: string;
  args: string;
  action: PolicyAction;
  timestamp: number;
}
