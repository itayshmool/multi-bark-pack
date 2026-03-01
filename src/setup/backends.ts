import { errorMessage } from '../utils/error.js';
import { execSync, spawn } from 'node:child_process';
import { SETUP_EXEC_OPTS, SETUP_SPAWN_ENV } from './shared.js';

const EXEC_OPTS = { ...SETUP_EXEC_OPTS, timeout: 15000 };

interface BackendDef {
  name: string;
  displayName: string;
  cli: string;
  installCmd: string;
  versionCmd: string;
  testCmd: string;
  authType: string;
  authCmd?: string;
  authInstructions: string;
  authEnvVar?: string;
  models: string[];
  defaultModel: string;
}

interface BackendStatus {
  name: string;
  displayName: string;
  installed: boolean;
  version: string | null;
  authType: string;
  authInstructions: string;
  authEnvVar: string | null;
  models: string[];
  defaultModel: string;
  error?: string;
}

const BACKENDS: Record<string, BackendDef> = {
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    cli: 'claude',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    versionCmd: 'claude --version',
    testCmd: 'claude --version',
    authType: 'cli-login',
    authInstructions: 'Run `claude` in terminal to complete browser-based login.',
    models: ['opus', 'sonnet', 'haiku'],
    defaultModel: 'sonnet',
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    cli: 'agent',
    installCmd: 'brew install --cask cursor-cli',
    versionCmd: 'agent --version',
    testCmd: 'agent --version',
    authType: 'desktop-app',
    authInstructions: 'Login through the Cursor desktop app. The CLI shares auth with the desktop app.',
    models: ['auto'],
    defaultModel: 'auto',
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    installCmd: 'npm install -g @openai/codex',
    versionCmd: 'codex --version',
    testCmd: 'codex --version',
    authType: 'device-auth',
    authCmd: 'codex login --device-auth',
    authInstructions: 'Free tier available via ChatGPT account. Click "Login" to start device auth flow.',
    models: ['default', 'o3', 'o4-mini'],
    defaultModel: 'default',
  },
  gemini: {
    name: 'gemini',
    displayName: 'Gemini',
    cli: 'gemini',
    installCmd: 'npm install -g @google/gemini-cli',
    versionCmd: 'gemini --version',
    testCmd: 'gemini --version',
    authType: 'api-key',
    authEnvVar: 'GEMINI_API_KEY',
    authInstructions: 'Get an API key from Google AI Studio (aistudio.google.com) and paste it below.',
    models: ['auto-gemini-2.5', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultModel: 'auto-gemini-2.5',
  },
};

export function checkBackend(name: string): BackendStatus {
  const backend = BACKENDS[name];
  if (!backend) return { name, displayName: name, installed: false, version: null, authType: '', authInstructions: '', authEnvVar: null, models: [], defaultModel: '', error: 'Unknown backend' };

  let installed = false;
  let version: string | null = null;

  try {
    execSync(`which ${backend.cli}`, EXEC_OPTS);
    installed = true;
  } catch { /* not installed */ }

  if (installed) {
    try {
      version = execSync(backend.versionCmd, EXEC_OPTS).trim();
      if (version.length > 200) {
        version = version.split('\n')[0].slice(0, 100);
      }
    } catch { /* version check failed */ }
  }

  return {
    name: backend.name,
    displayName: backend.displayName,
    installed,
    version,
    authType: backend.authType,
    authInstructions: backend.authInstructions,
    authEnvVar: backend.authEnvVar || null,
    models: backend.models,
    defaultModel: backend.defaultModel,
  };
}

export function checkAll(): BackendStatus[] {
  return Object.keys(BACKENDS).map(checkBackend);
}

export function installBackend(name: string, onData?: (data: string) => void): Promise<{ success: boolean; output: string } & BackendStatus> {
  const backend = BACKENDS[name];
  if (!backend) throw new Error(`Unknown backend: ${name}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', backend.installCmd], {
      env: SETUP_SPAWN_ENV,
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (onData) onData(chunk.toString());
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (onData) onData(chunk.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const status = checkBackend(name);
        resolve({ success: true, ...status, output });
      } else {
        reject(new Error(`Install failed (exit ${code}): ${output.slice(-500)}`));
      }
    });
  });
}

export function testBackend(name: string): { success: boolean; output?: string; error?: string } {
  const backend = BACKENDS[name];
  if (!backend) return { success: false, error: 'Unknown backend' };

  try {
    const output = execSync(backend.testCmd, { ...EXEC_OPTS, timeout: 30000 }).trim();
    const clean = output.length > 200 ? output.split('\n')[0].slice(0, 100) : output;
    return { success: true, output: clean };
  } catch (e) {
    const message = errorMessage(e);
    return { success: false, error: message.slice(0, 300) };
  }
}

export function startDeviceAuth(name: string, onData?: (data: string) => void): Promise<{ success: boolean; output: string }> {
  const backend = BACKENDS[name];
  if (!backend || backend.authType !== 'device-auth') {
    throw new Error(`Backend ${name} does not support device auth`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', backend.authCmd!], {
      env: SETUP_SPAWN_ENV,
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (onData) onData(text);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (onData) onData(text);
    });

    proc.on('close', (code) => {
      if (code === 0 || output.includes('Successfully logged in')) {
        resolve({ success: true, output });
      } else {
        reject(new Error(`Auth failed (exit ${code}): ${output.slice(-500)}`));
      }
    });
  });
}

export function testGeminiKey(apiKey: string): { success: boolean; message?: string; error?: string } {
  if (!apiKey || !apiKey.startsWith('AIza')) {
    return { success: false, error: 'Invalid API key format (should start with AIza)' };
  }
  return { success: true, message: 'API key format valid' };
}

export { BACKENDS };
