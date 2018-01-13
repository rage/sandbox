import * as tar from "tar-fs";
import { join } from "path";
import { createReadStream } from "fs";
import { promisify } from "util";
import { pack } from "tar-fs";
const exec = promisify(require("child_process").exec);
const readFile = promisify(require("fs").readFile);
const unlink = promisify(require("fs").unlink);

interface RunResult {
  test_output: string;
  stdout: string;
  stderr: string;
  valgrind: string;
  validations: string;
  vm_log: string;
}

export const handleSubmission = (id: string): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    console.log("Handling submission" + id);
    const path = join("uploads", id);
    const outputPath = join("work", id);
    const extractStream = createReadStream(path).pipe(tar.extract(outputPath));
    extractStream.on("finish", async () => {
      console.log("Extracted");
      try {
        const results = await runTests(outputPath, id);
        resolve(results);
      } catch (e) {
        console.error(
          `An error occurred while running: ${id}. Error was: ${e}`
        );
        reject(e);
      }
    });
  });
};

async function runTests(
  path: string,
  submission_id: string
): Promise<RunResult> {
  const id = `sandbox-submission-${submission_id}`;
  console.time(id);
  const filesToRemoveAfter: string[] = [];

  const getFile = async (filename: string): Promise<string> => {
    const path = `${id}_${filename}`;
    try {
      await exec(`docker cp '${id}':/app/${filename} '${path}'`);
      filesToRemoveAfter.push(path);
      return await readFile(path, "utf8");
    } catch (_) {
      console.warn(`Could not find ${filename}`);
      return "";
    }
  };

  await exec(`docker create --name '${id}' --memory=1G --cpus=1 -i nygrenh/sandbox-next`);
  await exec(`docker cp '${path}/.' '${id}':/app`);
  ensureStops(id);
  const log = await exec(`docker start -i '${id}'`);
  console.log("Ran tests!");
  const test_output = await getFile("test_output.txt");
  const stdout = await getFile("stdout.txt");
  const stderr = await getFile("stderr.txt");
  const valgrind = await getFile("valgrind.log");
  const validations = await getFile("validations.json");
  const vm_log = log.stdout + log.stderr;
  setImmediate(async () => {
    await exec(`docker rm --force '${id}'`);
    filesToRemoveAfter.forEach(async path => {
      await unlink(path);
    });
  });
  console.timeEnd(id);

  return {
    test_output,
    stdout,
    stderr,
    valgrind,
    validations,
    vm_log
  };
}

function ensureStops(id: string) {
  setTimeout(async () => {
    console.log("Time is up!");
    try {
      await exec(`docker kill '${id}'`);
      console.log(`Submission ${id} timed out.`);
    } catch (e) {}
  }, 20000);
}
