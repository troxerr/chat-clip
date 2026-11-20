"use strict";

const { stateDir } = require("./platform.js");

// whisper.cpp plumbing for burned-in VOD captions: find whisper-cli, fetch the
// model once, and turn a clip into word timings.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MODEL_NAME = "ggml-base.en.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
const MODEL_MIN_BYTES = 100 * 1024 * 1024; // the real file is about 148 MB

function appSupportDir(env = process.env) {
  return stateDir(env);
}

function modelPath(env = process.env) {
  if (env.HIGHLIGHT_DESK_WHISPER_MODEL) return path.resolve(env.HIGHLIGHT_DESK_WHISPER_MODEL);
  const dir = env.HIGHLIGHT_DESK_MODELS ? path.resolve(env.HIGHLIGHT_DESK_MODELS) : path.join(appSupportDir(env), "models");
  return path.join(dir, MODEL_NAME);
}

// whisper-cli on PATH, then in the app's bundled runtime.
function findWhisper({ env = process.env, extraDirs = [path.join(__dirname, "..", "runtime", "bin")] } = {}) {
  const dirs = [...String(env.PATH || "").split(path.delimiter).filter(Boolean), ...extraDirs];
  const names = process.platform === "win32" ? ["whisper-cli.exe", "whisper-cli"] : ["whisper-cli"];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function modelReady(file) {
  try { return fs.statSync(file).size >= MODEL_MIN_BYTES || Boolean(process.env.HIGHLIGHT_DESK_WHISPER_MODEL); } catch { return false; }
}

// Downloads the model once into Application Support, reporting progress.
async function ensureModel({ file = modelPath(), url = MODEL_URL, onProgress } = {}) {
  if (modelReady(file)) return { ok: true, path: file, downloaded: false };
  if (process.env.HIGHLIGHT_DESK_WHISPER_MODEL) return { ok: false, error: `Model not found: ${file}` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = file + ".partial";
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || 0;
    const out = fs.createWriteStream(partial);
    let received = 0;
    let lastReport = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
      if (onProgress && Date.now() - lastReport > 500) {
        lastReport = Date.now();
        onProgress({ fraction: total ? received / total : 0, bytes: received, total });
      }
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    if (received < MODEL_MIN_BYTES) throw new Error(`download was only ${received} bytes`);
    fs.renameSync(partial, file);
    if (onProgress) onProgress({ fraction: 1, bytes: received, total: total || received, done: true });
    return { ok: true, path: file, downloaded: true };
  } catch (error) {
    try { fs.rmSync(partial, { force: true }); } catch {}
    return { ok: false, error: error.message };
  }
}

// `run` is the caller's child-process runner (so cancel kills these too).
async function transcribeClip({ run, ffmpegPath = "ffmpeg", whisperPath, model, input, workDir }) {
  const wav = path.join(workDir, "audio.wav");
  const extracted = await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  if (extracted.code !== 0) return { ok: false, error: extracted.stderr || "Could not extract audio." };
  const base = path.join(workDir, "words");
  const threads = String(Math.max(1, Math.min(8, os.cpus().length - 1)));
  const result = await run(whisperPath, ["-m", model, "-f", wav, "-l", "en", "-ml", "1", "-sow", "-oj", "-of", base, "-np", "-t", threads]);
  if (result.code !== 0) return { ok: false, error: result.stderr || `whisper-cli exited with ${result.code}` };
  try {
    return { ok: true, json: JSON.parse(fs.readFileSync(base + ".json", "utf8")) };
  } catch (error) {
    return { ok: false, error: `Could not read the transcript: ${error.message}` };
  }
}

module.exports = { MODEL_NAME, MODEL_URL, modelPath, findWhisper, modelReady, ensureModel, transcribeClip };
