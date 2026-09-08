/**
 * Provider adapter contract.
 *
 * The core engine only ever talks to this interface, so adding a provider is
 * one new file plus one registry line. No provider-specific branching is
 * allowed above this layer.
 */

export type ProviderStatus =
  | 'not_configured'
  | 'connected'
  | 'connection_failed'
  | 'temporarily_unavailable'
  | 'quota_limited'
  | 'rate_limited'
  | 'invalid_credential'
  | 'model_unavailable';

/** Categories the engine must keep distinct from "missing knowledge". */
export type ProviderErrorType =
  | 'authentication_error'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'model_unavailable'
  | 'timeout_error'
  | 'provider_unavailable'
  | 'provider_error';

export interface ProviderCredentials {
  apiKey: string;
  baseUrl?: string;
  orgId?: string;
}

export interface DiscoveredModel {
  id: string;
  displayName: string;
}

export interface ProviderTestResult {
  ok: boolean;
  status: ProviderStatus;
  /** Safe to show an authenticated customer; never shown to visitors. */
  message: string;
  latencyMs: number;
  httpStatus?: number;
  errorType?: ProviderErrorType;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  credentials: ProviderCredentials;
  model: string;
  system: string;
  messages: ChatTurn[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface GenerateSuccess {
  ok: true;
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface GenerateFailure {
  ok: false;
  errorType: ProviderErrorType;
  /** Technical detail for admins/diagnostics. Never returned to visitors. */
  message: string;
  httpStatus: number;
  retryAfter?: string;
  latencyMs: number;
  model: string;
}

export type GenerateResult = GenerateSuccess | GenerateFailure;

export interface ProviderAdapter {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** Where the customer creates their own key. */
  readonly consoleUrl: string;
  /**
   * What that provider's key looks like, e.g. 'sk-ant-...'. Shown next to the
   * field so a customer can tell at a glance whether they pasted the right
   * thing - the commonest support question by a distance.
   */
  readonly keyHint: string;
  readonly requiresBaseUrl: boolean;
  readonly supportsOrgId: boolean;

  validate(credentials: ProviderCredentials): { ok: boolean; message?: string };
  testConnection(credentials: ProviderCredentials, timeoutMs: number): Promise<ProviderTestResult>;
  listModels(credentials: ProviderCredentials, timeoutMs: number): Promise<DiscoveredModel[]>;
  generate(input: GenerateInput): Promise<GenerateResult>;
  /** Preferred default when several discovered models are usable. */
  preferredModelOrder(): string[];
}
