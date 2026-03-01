import { execSync, spawn } from 'node:child_process';
import { SETUP_EXEC_OPTS, SETUP_SPAWN_ENV } from './shared.js';

const EXEC_OPTS = SETUP_EXEC_OPTS;

interface PrereqCheck {
  installed: boolean;
  version?: string;
}

interface Prerequisite {
  name: string;
  displayName: string;
  required: boolean;
  description?: string;
  check: () => PrereqCheck;
  installCmd: string;
}

interface PrereqStatus {
  name: string;
  displayName: string;
  required: boolean;
  description: string;
  installed: boolean;
  version: string | null;
  installCmd: string;
}

interface InstallResult {
  success: boolean;
  version?: string;
  output: string;
}

const PREREQUISITES: Prerequisite[] = [
  {
    name: 'node',
    displayName: 'Node.js',
    required: true,
    check: () => {
      try {
        const v = execSync('node --version', EXEC_OPTS).trim();
        return { installed: true, version: v };
      } catch {
        return { installed: false };
      }
    },
    installCmd: 'brew install node',
  },
  {
    name: 'tmux',
    displayName: 'tmux',
    required: true,
    check: () => {
      try {
        const v = execSync('tmux -V', EXEC_OPTS).trim();
        return { installed: true, version: v };
      } catch {
        return { installed: false };
      }
    },
    installCmd: 'brew install tmux',
  },
  {
    name: 'ffmpeg',
    displayName: 'ffmpeg',
    required: false,
    description: 'Required for voice message transcription',
    check: () => {
      try {
        const out = execSync('ffmpeg -version', EXEC_OPTS);
        const v = out.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
        return { installed: true, version: v };
      } catch {
        return { installed: false };
      }
    },
    installCmd: 'brew install ffmpeg',
  },
  {
    name: 'whisper',
    displayName: 'whisper.cpp',
    required: false,
    description: 'Required for voice message transcription',
    check: () => {
      try {
        execSync('which whisper-cli', EXEC_OPTS);
        return { installed: true, version: 'found' };
      } catch {
        try {
          execSync('which whisper', EXEC_OPTS);
          return { installed: true, version: 'found' };
        } catch {
          return { installed: false };
        }
      }
    },
    installCmd: 'brew install whisper-cpp',
  },
];

export function checkAll(): PrereqStatus[] {
  return PREREQUISITES.map(prereq => {
    const status = prereq.check();
    return {
      name: prereq.name,
      displayName: prereq.displayName,
      required: prereq.required,
      description: prereq.description || '',
      installed: status.installed,
      version: status.version || null,
      installCmd: prereq.installCmd,
    };
  });
}

export function installPrereq(name: string, onData?: (data: string) => void): Promise<InstallResult> {
  const prereq = PREREQUISITES.find(p => p.name === name);
  if (!prereq) throw new Error(`Unknown prerequisite: ${name}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', prereq.installCmd], {
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
        const status = prereq.check();
        resolve({ success: true, version: status.version, output });
      } else {
        reject(new Error(`Install failed (exit ${code}): ${output.slice(-500)}`));
      }
    });
  });
}

export { PREREQUISITES };
