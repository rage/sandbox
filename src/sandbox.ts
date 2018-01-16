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
  status: string;
  exit_code: string;
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests(
  path: string,
  submission_id: string
): Promise<RunResult> {
  const id = `sandbox-submission-${submission_id}`;
  console.time(id);
  const filesToRemoveAfter: string[] = [];
  let status = "failed";

  const getFile = async (filename: string): Promise<string> => {
    const path = join("work", `${id}_${filename}`);
    try {
      await exec(`docker cp '${id}':/app/${filename} '${path}'`);
      filesToRemoveAfter.push(path);
      return await readFile(path, "utf8");
    } catch (_) {
      console.warn(`Could not find ${filename}`);
      return "";
    }
  };
  console.time("running");
  const pwd = join(__dirname, "..");
  await exec(
    `docker create --name '${id}' --memory 1G --cpus 1 --network none --mount type=bind,source=${pwd}/${path},target=/app -it nygrenh/sandbox-next /app/init`
  );
  // await exec(`docker cp '${path}/.' '${id}':/app`);
  await exec(`docker cp 'tmc-run' '${id}':/app/tmc-run`);
  await exec(`docker cp 'init' '${id}':/app/init`);
  ensureStops(id);
  let vm_log = "";
  try {
    console.time("exec run");
    const log = await exec(`docker start -i '${id}' | ts -s`);
    console.timeEnd("exec run");
    console.timeEnd("running");
    vm_log = log.stdout + log.stderr;
    console.log("Ran tests!");
  } catch (e) {
    console.warn(JSON.stringify(e));
    console.timeEnd("running");
    // TODO: handle OOM
    status = "timeout";
  }
  setImmediate(async () => {
    await exec(`docker rm --force '${id}'`);
    filesToRemoveAfter.forEach(async path => {
      await unlink(path);
    });
  });

  const test_output = await getFile("test_output.txt");
  const stdout = await getFile("stdout.txt");
  const stderr = await getFile("stderr.txt");
  const valgrind = await getFile("valgrind.log");
  const validations = await getFile("validations.json");
  const exit_code = (await getFile("exit_code.txt")).trim();
  if (status !== "timeout" && exit_code === "0") {
    status = "finished";
  }

  console.timeEnd(id);

  return {
    test_output,
    stdout,
    stderr,
    valgrind,
    validations,
    vm_log,
    exit_code,
    status
  };
}

function ensureStops(id: string) {
  setTimeout(async () => {
    console.log("Time is up!");
    try {
      await exec(`docker kill '${id}'`);
      console.log(`Submission ${id} timed out.`);
    } catch (e) {}
  }, 60000);
}
