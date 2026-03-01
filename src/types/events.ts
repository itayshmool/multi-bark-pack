export type TimelineEventType =
  | 'spawn'
  | 'delegate'
  | 'reborn'
  | 'message_sent'
  | 'response'
  | 'timeout'
  | 'model_switch'
  | 'skill_inject'
  | 'cwd_change'
  | 'file_sent'
  | 'stop'
  | 'clear'
  | 'hard_delete'
  | 'reset'
  | 'security_block'
  | 'server'
  | 'tool_start'
  | 'thinking'
  | 'text_output'
  | 'agent_error'
  | 'session_init';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  agentId: string | null;
  agentName: string | null;
  backend: string | null;
  timestamp: string;
  message: string;
  meta: Record<string, unknown> | null;
}

