import { execFile as execFileCallback } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const BINARY_VERSION = "0.39.4";
const BINARY_URL = `https://download.mooc.fi/tmc-langs-rust/tmc-langs-cli-x86_64-unknown-linux-musl-${BINARY_VERSION}`;
const CHECKSUM_URL = `${BINARY_URL}.sha256`;
const CACHE_DIR = "/tmp/tmc-langs-cli-cache";
const BINARY_PATH = `${CACHE_DIR}/tmc-langs-cli`;
const CHECKSUM_PATH = `${BINARY_PATH}.sha256`;

async function verifyChecksum(binaryPath: string, checksumPath: string): Promise<void> {
  const checksumContent = await readFile(checksumPath, "utf8");
  const expectedHash = checksumContent.trim().split(/\s+/)[0];
  if (!expectedHash) throw new Error("Checksum file is empty or malformed");
  const { stdout } = await execFile("sha256sum", [binaryPath]);
  const actualHash = stdout.trim().split(/\s+/)[0];
  if (expectedHash !== actualHash) {
    throw new Error(
      `Checksum mismatch for ${binaryPath}: expected ${expectedHash}, got ${actualHash}`,
    );
  }
}

export class TmcLangs {
  private constructor(private readonly binaryPath: string) {}

  static async setup(): Promise<TmcLangs> {
    const missing = !existsSync(BINARY_PATH) || statSync(BINARY_PATH).size === 0;
    if (missing) {
      await mkdir(CACHE_DIR, { recursive: true });
      await Promise.all([
        execFile("curl", ["--fail", "-L", "-o", BINARY_PATH, BINARY_URL]),
        execFile("curl", ["--fail", "-L", "-o", CHECKSUM_PATH, CHECKSUM_URL]),
      ]);
      await verifyChecksum(BINARY_PATH, CHECKSUM_PATH);
      await chmod(BINARY_PATH, 0o755);
    }
    return new TmcLangs(BINARY_PATH);
  }

  async compressProject(
    exercisePath: string,
    outputPath: string,
    format: "tar" | "zstd" = "tar",
  ): Promise<void> {
    // --naive includes ALL files (skips student-file-policy filtering), which is
    // required for sandbox tests: we need test/ and tmc/ directories included.
    await execFile(this.binaryPath, [
      "compress-project",
      "--exercise-path",
      exercisePath,
      "--output-path",
      outputPath,
      "--compression",
      format,
      "--naive",
    ]);
  }
}
