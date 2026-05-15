import { copyFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const PYTHON_TEMPLATE_DIR =
  "/tmp/tmc-langs-rust/sample_exercises/python3/exercise";
const MAKE_PASSING_DIR =
  "/tmp/tmc-langs-rust/sample_exercises/make/passing-exercise";

export class SubmissionBuilder {
  private files = new Map<string, string | Buffer>();

  addFile(relPath: string, content: string | Buffer): this {
    this.files.set(relPath, content);
    return this;
  }

  removeFile(relPath: string): this {
    this.files.delete(relPath);
    return this;
  }

  /**
   * Seeds builder with the Python tmc/ runner framework and test/__init__.py.
   * Does NOT add src/ — caller provides student source files.
   */
  withPythonTemplate(): this {
    const tplFiles = [
      "tmc/__init__.py",
      "tmc/__main__.py",
      "tmc/django.py",
      "tmc/points.py",
      "tmc/reflect.py",
      "tmc/result.py",
      "tmc/runner.py",
      "tmc/utils.py",
      "test/__init__.py",
      ".tmcproject.yml",
    ];
    for (const rel of tplFiles) {
      const src = join(PYTHON_TEMPLATE_DIR, rel);
      if (existsSync(src)) {
        this.files.set(rel, `__TEMPLATE__:${src}`);
      }
    }
    return this;
  }

  /**
   * Seeds builder with the Make/C passing exercise (Makefile, test files).
   * Does NOT add src/*.c — caller provides those.
   */
  withMakeTemplate(): this {
    const tplFiles = [
      "Makefile",
      "src/Makefile",
      "src/source.h",
      "test/Makefile",
      "test/tmc-check.c",
      "test/tmc-check.h",
      "test/checkhelp.c",
      "test/test_source.c",
    ];
    for (const rel of tplFiles) {
      const src = join(MAKE_PASSING_DIR, rel);
      if (existsSync(src)) {
        this.files.set(rel, `__TEMPLATE__:${src}`);
      }
    }
    return this;
  }

  /**
   * Compress the current file set into a sandbox-compatible archive.
   * Files are at the archive root (no parent directory prefix), matching
   * what prepare-submission --no-archive-prefix produces.
   * Returns the absolute path to the resulting archive.
   */
  async build(format: "tar" | "zstd" = "tar"): Promise<string> {
    const dir = await this.buildDirectory();
    const ext = format === "zstd" ? "tar.zst" : "tar";
    const outPath = join(tmpdir(), `sandbox-submission-${randomUUID()}.${ext}`);
    try {
      await (format === "zstd"
        ? execFile("tar", ["-I", "zstd", "-cf", outPath, "-C", dir, "."])
        : execFile("tar", ["-cf", outPath, "-C", dir, "."]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return outPath;
  }

  /**
   * Write all files to a temp directory without compressing.
   * Caller is responsible for cleanup.
   */
  async buildDirectory(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "sandbox-exercise-"));
    await Promise.all(
      Array.from(this.files).map(async ([rel, content]) => {
        const dest = join(dir, rel);
        await mkdir(dirname(dest), { recursive: true });
        if (typeof content === "string" && content.startsWith("__TEMPLATE__:")) {
          const src = content.slice("__TEMPLATE__:".length);
          await copyFile(src, dest);
        } else {
          await writeFile(dest, content);
        }
      }),
    );
    return dir;
  }
}
