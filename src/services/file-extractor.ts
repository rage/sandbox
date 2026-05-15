import { createReadStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { resolve, sep } from "node:path";
import * as tar from "tar-fs";
import type { SupportedMimeType } from "../types.js";

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024; // 512 MB

// Synthetic root used only for path-safety resolution — never touches the filesystem.
const SAFE_PATH_ROOT = "/sandbox-root";

function execFile(file: string, args: string[]): Promise<void> {
  return new Promise((_resolve, reject) => {
    execFileCallback(file, args, (error, _stdout, stderr) => {
      if (error) {
        const stderrStr = stderr;
        const wrapped = new Error(
          `${file} failed for ${args.join(" ")}: ${stderrStr || error.message}`,
        );
        reject(wrapped);
      } else {
        _resolve();
      }
    });
  });
}

function assertNever(x: never): never {
  throw new Error(`Unsupported mime type: ${String(x)}`);
}

function isSafePath(entryPath: string): boolean {
  const resolved = resolve(SAFE_PATH_ROOT, entryPath);
  return resolved === SAFE_PATH_ROOT || resolved.startsWith(SAFE_PATH_ROOT + sep);
}

const extractTar = async (inputPath: string, outputPath: string): Promise<void> => {
  await mkdir(outputPath, { recursive: true });
  return new Promise((_resolve, reject) => {
    let entryCount = 0;
    let totalBytes = 0;
    let overLimit = false;

    const options: tar.ExtractOptions = {
      ignore: (_name: string, header: tar.Headers | undefined) => {
        if (!header) {
          return true;
        }
        if (header.type === "symlink" || header.type === "link") {
          return true;
        }
        if (!isSafePath(header.name)) {
          return true;
        }
        if (overLimit) {
          return true;
        }

        entryCount++;
        totalBytes += header.size ?? 0;

        if (entryCount > MAX_ARCHIVE_ENTRIES || totalBytes > MAX_ARCHIVE_BYTES) {
          overLimit = true;
          return true;
        }
        return false;
      },
    };

    const limitError = () =>
      new Error(
        entryCount > MAX_ARCHIVE_ENTRIES
          ? `Archive exceeds maximum entry count of ${MAX_ARCHIVE_ENTRIES}`
          : `Archive exceeds maximum extraction size of ${MAX_ARCHIVE_BYTES} bytes`,
      );

    const readStream = createReadStream(inputPath);
    const extractStream = readStream.pipe(tar.extract(outputPath, options));
    // If overLimit is set, a stream error means the archive was truncated after the over-sized
    // header — report the limit violation rather than the underlying stream error.
    readStream.on("error", (err) => reject(overLimit ? limitError() : err));
    extractStream.on("finish", () => {
      if (overLimit) {
        reject(limitError());
      } else {
        _resolve();
      }
    });
    extractStream.on("error", (err) => reject(overLimit ? limitError() : err));
  });
};

const extractZstd = async (inputPath: string, outputPath: string): Promise<void> => {
  const tmpTar = `${inputPath}.decompressed.tar`;
  try {
    await execFile("zstd", ["-d", inputPath, "-o", tmpTar, "--force"]);
    await extractTar(tmpTar, outputPath);
  } finally {
    try {
      await unlink(tmpTar);
    } catch {
      // temp file may already be gone
    }
  }
};

export async function extractFile(
  inputPath: string,
  outputPath: string,
  mimetype: SupportedMimeType,
): Promise<void> {
  if (mimetype === "application/zstd") {
    await extractZstd(inputPath, outputPath);
  } else if (mimetype === "application/x-tar") {
    await extractTar(inputPath, outputPath);
  } else {
    assertNever(mimetype);
  }
}
