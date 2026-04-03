export type AgentName = 'claude' | 'codex' | 'kimi';

export type Sender = 'human' | 'system' | AgentName;
export type CollaborationMode = 'user_request' | 'delegated_work' | 'review_handoff';

export interface SendOptions {
  prompt: string;
  sessionId?: string;
  workdir: string;
  runId: string;
}

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string }
  | { type: 'delegate_request'; target: AgentName; message: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

export interface AgentDriver {
  readonly name: AgentName;
  readonly displayName: string;
  send(opts: SendOptions): AsyncIterable<AgentEvent>;
  abort(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface ToolUseContent {
  type: 'tool_use';
  tool: string;
  input: unknown;
  collapsed: boolean;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool: string;
  output: string;
  collapsed: boolean;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  text: string;
}

export interface DelegateContent {
  type: 'delegate';
  target: AgentName;
  message: string;
}

export interface SystemContent {
  type: 'system';
  text: string;
  tone?: 'info' | 'error';
}

export type MessageContent =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | DelegateContent
  | SystemContent;

export interface Message {
  id: string;
  sender: Sender;
  content: MessageContent[];
  timestamp: Date;
  status: 'streaming' | 'done' | 'error';
  usage?: TokenUsage;
}

export interface AgentState {
  name: AgentName;
  sessionId: string | null;
  status: 'idle' | 'running' | 'error';
  available: boolean;
  enabled: boolean;
  queueLength: number;
  pendingReviewCount: number;
  activeMode: CollaborationMode | null;
  activeRunId: string | null;
  lastError: string | null;
}

export interface AppState {
  messages: Message[];
  agents: Record<AgentName, AgentState>;
  workdir: string;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  sessionCount: number;
}

export interface PersistedMessage {
  id: string;
  sender: Sender;
  content: MessageContent[];
  timestamp: string;
  status: Message['status'];
  usage?: TokenUsage;
}

export interface DelegateRequest {
  target: AgentName;
  message: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentSessions: Partial<Record<AgentName, string>>;
}

export interface WorkspaceSessions {
  activeSessionId: string | null;
  agentEnabled: Record<AgentName, boolean>;
  sessions: SessionInfo[];
}
