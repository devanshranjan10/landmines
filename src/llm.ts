import { spawn } from 'node:child_process';
import type * as AnthropicModuleNs from '@anthropic-ai/sdk';
import type * as ZodHelpersNs from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

type AnthropicModule = typeof AnthropicModuleNs;
type ZodHelpers = typeof ZodHelpersNs;
import type { Http } from './http.js';

/**
 * A model that turns one issue thread into a trigger card (src/cards.ts). Only `scan --cards` / `landmine cards`
 * use one; the hook never calls a model (D-34).
 */
export interface LlmProvider {
  name: ProviderName;
  model: string;
  /** Returns JSON matching `schema`, or throws. */
  json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T>;
}

export type ProviderName = 'anthropic' | 'claude-cli' | 'openai';
export const PROVIDERS: readonly ProviderName[] = ['anthropic', 'claude-cli', 'openai'];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-opus-5-5',
  'claude-cli': 'opus',
  openai: 'gpt-5-mini',
};

export interface ProviderOptions {
  model?: string;
  env?: NodeJS.ProcessEnv;
  http?: Http;
  /** For claude-cli: run this instead of `claude` (tests). */
  exec?: (args: string[], input: string) => Promise<string>;
}

/** Anthropic Messages API through the official SDK (an optional peer dependency), with structured outputs. ANTHROPIC_API_KEY (or an `ant` profile). */
async function anthropic(opts: ProviderOptions): Promise<LlmProvider> {
  // The SDK is an optional peer dependency, so `npx landmines` stays small for everyone who never uses this provider.
  let sdk: [AnthropicModule, ZodHelpers];
  try {
    sdk = await Promise.all([import('@anthropic-ai/sdk'), import('@anthropic-ai/sdk/helpers/zod')]);
  } catch {
    throw new Error('the anthropic provider needs the Anthropic SDK: run `npm i -D @anthropic-ai/sdk` (or use --provider claude-cli with a Claude Code login)');
  }
  const [{ default: Anthropic }, { zodOutputFormat }] = sdk;
  const http = opts.http;
  const client = new Anthropic({
    ...(opts.env?.ANTHROPIC_API_KEY ? { apiKey: opts.env.ANTHROPIC_API_KEY } : {}),
    ...(http ? { fetch: (url: string | URL | Request, init?: RequestInit) => http.fetch(String(url instanceof Request ? url.url : url), init) } : {}),
    maxRetries: 3,
  });
  const model = opts.model ?? DEFAULT_MODELS.anthropic;
  return {
    name: 'anthropic',
    model,
    async json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        // Card extraction is a short reading task; low effort keeps cost per issue down.
        output_config: { effort: 'low', format: zodOutputFormat(schema as never) },
        messages: [{ role: 'user', content: user }],
      });
      if (response.stop_reason === 'refusal') throw new Error('model declined');
      if (response.parsed_output == null) throw new Error('no structured output');
      return schema.parse(response.parsed_output);
    },
  };
}

function runClaude(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${String(code)}: ${(err || out).slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

/**
 * The Claude Code CLI in print mode, so an existing Claude Code login works without an API key. Minimal system prompt,
 * no tools, no settings or MCP servers, structured output via --json-schema.
 */
function claudeCli(opts: ProviderOptions): LlmProvider {
  const exec = opts.exec ?? runClaude;
  const model = opts.model ?? DEFAULT_MODELS['claude-cli'];
  return {
    name: 'claude-cli',
    model,
    async json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
      const args = [
        '-p',
        '--model',
        model,
        '--effort',
        'low',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(await jsonSchema(schema)),
        '--system-prompt',
        system,
        '--tools',
        '',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
      ];
      const raw = await exec(args, user);
      const envelope = JSON.parse(raw) as { structured_output?: unknown; result?: unknown; is_error?: boolean };
      if (envelope.is_error) throw new Error(`claude: ${String(envelope.result).slice(0, 200)}`);
      const value = envelope.structured_output ?? (typeof envelope.result === 'string' ? (JSON.parse(envelope.result) as unknown) : envelope.result);
      return schema.parse(value);
    },
  };
}

/** Any OpenAI-compatible chat endpoint (OpenAI, OpenRouter, Ollama, LM Studio, vLLM): OPENAI_API_KEY, OPENAI_BASE_URL. */
function openai(opts: ProviderOptions): LlmProvider {
  const env = opts.env ?? process.env;
  const base = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const fetcher = opts.http ?? { fetch: (u: string, i?: RequestInit) => globalThis.fetch(u, i) };
  const model = opts.model ?? DEFAULT_MODELS.openai;
  return {
    name: 'openai',
    model,
    async json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
      const res = await fetcher.fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(env.OPENAI_API_KEY ? { authorization: `Bearer ${env.OPENAI_API_KEY}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'trigger_card', schema: await jsonSchema(schema), strict: false } },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content ?? '';
      return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')));
    },
  };
}

/** JSON Schema for a zod schema, without the `$schema` draft URL (the claude CLI's validator cannot resolve it). */
async function jsonSchema(schema: z.ZodType): Promise<Record<string, unknown>> {
  const { toJSONSchema } = await import('zod');
  const { $schema: _draft, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export async function provider(name: ProviderName, opts: ProviderOptions = {}): Promise<LlmProvider> {
  switch (name) {
    case 'anthropic':
      return anthropic(opts);
    case 'claude-cli':
      return claudeCli(opts);
    case 'openai':
      return openai(opts);
  }
}
