import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';

/**
 * Standard temp file paths for an agent.
 */
export function getAgentFiles(agentId: string) {
  return {
    out: path.join(TMP_DIR, `${agentId}.out`),
    done: path.join(TMP_DIR, `${agentId}.done`),
    progress: path.join(TMP_DIR, `${agentId}.progress`),
    running: path.join(TMP_DIR, `${agentId}.running`),
    cwd: path.join(TMP_DIR, `${agentId}.cwd`),
    prompt: path.join(TMP_DIR, `${agentId}.prompt`),
    sysprompt: path.join(TMP_DIR, `${agentId}.sysprompt`),
    sh: path.join(TMP_DIR, `${agentId}.sh`),
    history: path.join(TMP_DIR, `${agentId}.history.json`),
    sendDir: path.join(TMP_DIR, `${agentId}-send`),
    events: path.join(TMP_DIR, `${agentId}.events`),
    phase: path.join(TMP_DIR, `${agentId}.phase`),
  };
}
