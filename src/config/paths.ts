import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is two levels up from src/config/
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const TMP_DIR = path.join(ROOT_DIR, '.bark-tmp');
export const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
export const TOOLS_DIR = path.join(ROOT_DIR, 'tools');

export const AGENTS_FILE = path.join(ROOT_DIR, 'agents.json');
export const ROUTING_FILE = path.join(ROOT_DIR, 'routing.json');
export const STATUS_FILE = path.join(ROOT_DIR, 'status.json');
export const PACKS_FILE = path.join(ROOT_DIR, 'packs.json');
export const MCP_CONFIG_FILE = path.join(ROOT_DIR, 'src', 'config', 'mcp-config.json');

export const SKILLS_DIR = path.join(
  ROOT_DIR,
  process.env.SKILLS_DIR || '.claude/skills',
);

