/**
 * Voice transcription via whisper.cpp (local, free).
 */

import { errorMessage } from '../utils/error.js';
import { execSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { EXEC_OPTS, WHISPER_MODEL } from './config.js';

/**
 * Transcribe an audio file using ffmpeg + whisper-cli.
 * Returns the transcribed text, or null on failure.
 */
export function transcribeAudio(audioFilePath: string): string | null {
  try {
    // Voice messages come as opus-in-ogg; whisper needs 16kHz WAV
    const wavFile = audioFilePath.replace(/\.[^.]+$/, '.wav');
    execSync(`ffmpeg -i "${audioFilePath}" -ar 16000 -ac 1 -y "${wavFile}" 2>/dev/null`, {
      ...EXEC_OPTS,
      timeout: 15000,
    });
    const result = execSync(
      `whisper-cli -m "${WHISPER_MODEL}" --language auto --no-timestamps "${wavFile}" 2>/dev/null`,
      {
        ...EXEC_OPTS,
        timeout: 60000,
      },
    );
    try {
      unlinkSync(wavFile);
    } catch {
      // ignore cleanup errors
    }
    return result.toString().trim() || null;
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.log(`  ❌ Transcription error: ${msg.substring(0, 200)}`);
    return null;
  }
}
