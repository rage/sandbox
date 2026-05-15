import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile, mkdir, symlink, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import * as tar from "tar-fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { extractFile } from "./file-extractor.js";
import type { SupportedMimeType } from "../types.js";

const execFile = promisify(execFileCallback);

function buildTarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "ascii");
  h.write("0100644\0", 100, "ascii"); // mode: rw-r--r--
  h.write("0000000\0", 108, "ascii"); // uid
  h.write("0000000\0", 116, "ascii"); // gid
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii"); // size (octal)
  h.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0",
    136,
    "ascii",
  ); // mtime
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  h[156] = 0x30; // typeflag: regular file
  h.write("ustar", 257, "ascii"); // ustar magic (byte 262 = 0x00 from alloc)
  h[263] = 0x30; // ustar version "0"
  h[264] = 0x30; // ustar version "0"
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i]!;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii"); // checksum
  return h;
}

function writeTar(
  outputPath: string,
  entries: ReadonlyArray<{ name: string; content: Buffer }>,
): Promise<void> {
  return new Promise((_resolve, reject) => {
    const out = createWriteStream(outputPath);
    out.on("error", reject);
    out.on("finish", _resolve);
    for (const { name, content } of entries) {
      out.write(buildTarHeader(name, content.length));
      if (content.length > 0) {
        out.write(content);
        const pad = (512 - (content.length % 512)) % 512;
        if (pad > 0) out.write(Buffer.alloc(pad));
      }
    }
    out.end(Buffer.alloc(1024)); // end-of-archive: two null 512-byte blocks
  });
}

/** Writes a single-entry tar whose content is `size` zero bytes, streamed in 64 KB chunks. */
function writeTarWithLargeEntry(outputPath: string, name: string, size: number): Promise<void> {
  return new Promise((_resolve, reject) => {
    const out = createWriteStream(outputPath);
    out.on("error", reject);
    out.on("finish", _resolve);
    out.write(buildTarHeader(name, size));
    const chunk = Buffer.alloc(65_536);
    let remaining = size;
    const pump = () => {
      while (remaining > 0) {
        const n = Math.min(chunk.length, remaining);
        remaining -= n;
        const keep = out.write(n < chunk.length ? chunk.subarray(0, n) : chunk);
        if (!keep && remaining > 0) {
          out.once("drain", pump);
          return;
        }
      }
      const pad = (512 - (size % 512)) % 512;
      if (pad > 0) out.write(Buffer.alloc(pad));
      out.end(Buffer.alloc(1024));
    };
    pump();
  });
}

let workDir: string;
let simpleTarPath: string;
let nestedTarPath: string;
let zstdTarPath: string;
let traversalTarPath: string;
let symlinkTarPath: string;

async function createTar(files: Record<string, string>, outputPath: string): Promise<void> {
  const srcDir = await mkdtemp(join(tmpdir(), "tar-src-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relPath, content]) => {
        const dest = join(srcDir, relPath);
        await mkdir(join(dest, ".."), { recursive: true });
        await writeFile(dest, content);
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(outputPath);
      const pack = tar.pack(srcDir);
      pack.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      pack.on("error", reject);
    });
  } finally {
    await rm(srcDir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "file-extractor-test-"));

  simpleTarPath = join(workDir, "simple.tar");
  await createTar({ "hello.txt": "hello world", "data.json": '{"ok":true}' }, simpleTarPath);

  nestedTarPath = join(workDir, "nested.tar");
  await createTar(
    {
      "src/main.py": "print('hello')",
      "src/utils.py": "pass",
      "test/__init__.py": "",
      "test/test_main.py": "assert True",
    },
    nestedTarPath,
  );

  zstdTarPath = join(workDir, "submission.tar.zst");
  const tmpSrcDir = await mkdtemp(join(tmpdir(), "zstd-src-"));
  const tmpTarPath = join(workDir, "submission-tmp.tar");
  try {
    await writeFile(join(tmpSrcDir, "solution.py"), "print('hello')");
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpTarPath);
      const pack = tar.pack(tmpSrcDir);
      pack.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      pack.on("error", reject);
    });
    await execFile("zstd", [tmpTarPath, "-o", zstdTarPath, "--force"]);
  } finally {
    await rm(tmpSrcDir, { recursive: true, force: true });
    await rm(tmpTarPath, { force: true });
  }

  // Archive with a path-traversal entry (../evil.txt) alongside a safe entry.
  traversalTarPath = join(workDir, "traversal.tar");
  await writeTar(traversalTarPath, [
    { name: "safe.txt", content: Buffer.from("safe") },
    { name: "../evil.txt", content: Buffer.from("evil") },
  ]);

  // Archive with a symlink entry pointing outside the output directory.
  symlinkTarPath = join(workDir, "symlink.tar");
  const symlinkSrcDir = await mkdtemp(join(tmpdir(), "sym-src-"));
  try {
    await writeFile(join(symlinkSrcDir, "normal.txt"), "normal content");
    await symlink("/etc/passwd", join(symlinkSrcDir, "evil_link.txt"));
    await execFile("tar", ["-cf", symlinkTarPath, "-C", symlinkSrcDir, "."]);
  } finally {
    await rm(symlinkSrcDir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("extractFile", () => {
  describe("tar extraction", () => {
    it("extracts files to output directory", async () => {
      const outDir = join(workDir, "out-simple");
      await extractFile(simpleTarPath, outDir, "application/x-tar");
      const hello = await readFile(join(outDir, "hello.txt"), "utf8");
      const data = await readFile(join(outDir, "data.json"), "utf8");
      expect(hello).toBe("hello world");
      expect(data).toBe('{"ok":true}');
    });

    it("handles nested directory structure", async () => {
      const outDir = join(workDir, "out-nested");
      await extractFile(nestedTarPath, outDir, "application/x-tar");
      const main = await readFile(join(outDir, "src/main.py"), "utf8");
      const test = await readFile(join(outDir, "test/__init__.py"), "utf8");
      expect(main).toBe("print('hello')");
      expect(test).toBe("");
    });

    it("creates output directory if it does not exist", async () => {
      const outDir = join(workDir, "nonexistent", "nested", "out");
      await expect(extractFile(simpleTarPath, outDir, "application/x-tar")).resolves.not.toThrow();
    });
  });

  describe("zstd extraction", () => {
    it("extracts .tar.zst to output directory", async () => {
      const outDir = join(workDir, "out-zstd");
      await extractFile(zstdTarPath, outDir, "application/zstd");
      const sol = await readFile(join(outDir, "solution.py"), "utf8");
      expect(sol).toBe("print('hello')");
    });

    it("creates output directory if it does not exist", async () => {
      const outDir = join(workDir, "out-zstd-new", "deep");
      await expect(extractFile(zstdTarPath, outDir, "application/zstd")).resolves.not.toThrow();
    });
  });

  describe("error handling", () => {
    it("throws on non-existent input file (tar)", async () => {
      const outDir = join(workDir, "out-missing");
      const missingPath = join(workDir, "does-not-exist.tar");
      await expect(extractFile(missingPath, outDir, "application/x-tar")).rejects.toThrow("ENOENT");
    });

    it("throws on non-existent input file (zstd)", async () => {
      const outDir = join(workDir, "out-missing-zstd");
      const missingPath = join(workDir, "does-not-exist.tar.zst");
      await expect(extractFile(missingPath, outDir, "application/zstd")).rejects.toThrow(
        "does-not-exist",
      );
    });

    it("throws on unsupported mime type", async () => {
      const outDir = join(workDir, "out-bad-mime");
      await expect(
        extractFile(simpleTarPath, outDir, "application/zip" as unknown as SupportedMimeType),
      ).rejects.toThrow("Unsupported mime type");
    });

    it("throws on corrupt tar data", async () => {
      const corruptPath = join(workDir, "corrupt.tar");
      await writeFile(corruptPath, "this is not a valid tar archive at all!!!!");
      const outDir = join(workDir, "out-corrupt");
      await expect(extractFile(corruptPath, outDir, "application/x-tar")).rejects.toThrow(
        "Unexpected end of data",
      );
    });

    it("throws on corrupt zstd data (not a valid zstd frame)", async () => {
      const corruptZstd = join(workDir, "corrupt.zst");
      await writeFile(corruptZstd, "this is definitely not a zstd archive");
      const outDir = join(workDir, "out-corrupt-zstd");
      await expect(extractFile(corruptZstd, outDir, "application/zstd")).rejects.toThrow(
        /zstd|corrupt|failed|invalid/i,
      );
    });
  });

  describe("extraction limits", () => {
    it("rejects archives that exceed the entry count limit", async () => {
      const manyEntriesTar = join(workDir, "many-entries.tar");
      const entries = Array.from({ length: 10_001 }, (_, i) => ({
        name: `file${i}.txt`,
        content: Buffer.from("x"),
      }));
      await writeTar(manyEntriesTar, entries);
      const outDir = join(workDir, "out-many-entries");
      await expect(extractFile(manyEntriesTar, outDir, "application/x-tar")).rejects.toThrow(
        "maximum entry count",
      );
    });

    it("rejects archives whose total size exceeds the byte limit", async () => {
      const bigSizeTar = join(workDir, "big-size.tar");
      await writeTarWithLargeEntry(bigSizeTar, "big.bin", 537_919_488);
      const outDir = join(workDir, "out-big-size");
      await expect(extractFile(bigSizeTar, outDir, "application/x-tar")).rejects.toThrow(
        "maximum extraction size",
      );
    });
  });

  describe("zstd path safety", () => {
    it("blocks path-traversal entries inside a zstd-wrapped tar", async () => {
      const innerTar = join(workDir, "traversal-inner.tar");
      await writeTar(innerTar, [
        { name: "safe.txt", content: Buffer.from("safe") },
        { name: "../zstd-evil.txt", content: Buffer.from("evil") },
      ]);
      const traversalZstd = join(workDir, "traversal.zst");
      await execFile("zstd", [innerTar, "-o", traversalZstd, "--force"]);

      const outDir = join(workDir, "out-zstd-traversal");
      await extractFile(traversalZstd, outDir, "application/zstd");

      // Safe entry should land in outDir.
      const safeContent = await readFile(join(outDir, "safe.txt"), "utf8");
      expect(safeContent).toBe("safe");

      // Traversal entry must not escape.
      const escapedPath = join(workDir, "zstd-evil.txt");
      await expect(access(escapedPath)).rejects.toThrow("ENOENT");
    });
  });

  describe("path safety", () => {
    it("extracts safe entries but skips path-traversal entries", async () => {
      const outDir = join(workDir, "out-traversal");
      await extractFile(traversalTarPath, outDir, "application/x-tar");

      // The safe entry should be extracted.
      const safeContent = await readFile(join(outDir, "safe.txt"), "utf8");
      expect(safeContent).toBe("safe");

      // The traversal entry must NOT land outside the output directory.
      const escapedPath = join(workDir, "evil.txt");
      await expect(access(escapedPath)).rejects.toThrow("ENOENT");
    });

    it("does not create a path-traversal file at any location", async () => {
      const outDir = join(workDir, "out-traversal-2");
      await extractFile(traversalTarPath, outDir, "application/x-tar");

      // Traversal entry should be silently skipped, not placed inside outDir either.
      const insideOutDir = join(outDir, "..", "evil.txt");
      await expect(access(insideOutDir)).rejects.toThrow("ENOENT");
    });

    it("skips symlink entries and does not create them in the output", async () => {
      const outDir = join(workDir, "out-symlink");
      await extractFile(symlinkTarPath, outDir, "application/x-tar");

      // Normal file should be extracted.
      const normalContent = await readFile(join(outDir, "normal.txt"), "utf8");
      expect(normalContent).toBe("normal content");

      // The symlink must not be created in the output directory.
      await expect(access(join(outDir, "evil_link.txt"))).rejects.toThrow("ENOENT");
    });

    it("rejects absolute path entries in tar archives", async () => {
      const absolutePathTar = join(workDir, "absolute.tar");
      await writeTar(absolutePathTar, [{ name: "/etc/injected.txt", content: Buffer.from("bad") }]);

      const outDir = join(workDir, "out-absolute");
      await extractFile(absolutePathTar, outDir, "application/x-tar");

      // Nothing should have been written to /etc/injected.txt.
      await expect(access("/etc/injected.txt")).rejects.toThrow("ENOENT");
    });
  });
});
