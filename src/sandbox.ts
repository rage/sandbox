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

export const handleSubmission = (id: string, dockerImage?: string): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    console.log("Handling submission" + id);
    const path = join("uploads", id);
    const outputPath = join("work", id);
    const extractStream = createReadStream(path).pipe(tar.extract(outputPath));
    extractStream.on("finish", async () => {
      console.log("Extracted");
      await exec(`chmod -R 777 ${outputPath}`);
      try {
        await exec(`chmod -R 777 ${outputPath}`);
        const results = await runTests(outputPath, id, dockerImage);
        resolve(results);
      } catch (e) {
        console.error(
          `An error occurred while running: ${id}. Error was: ${e}`
        );
        reject(e);
      } finally {
        setImmediate(async () => {
          try {
            await unlink(path);
            await exec(`rm -rf '${outputPath}'`);
          } catch (e) {
            console.warn(`Could not clean up ${id}.`, e);
          }
        });
      }
    });
  });
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests(
  path: string,
  submission_id: string,
  dockerImage?: string
): Promise<RunResult> {
  const id = `sandbox-submission-${submission_id}`;
  console.time(id);
  const pwd = join(__dirname, "..");
  const fullPath = `${pwd}/${path}`;
  let status = "failed";

  const getFile = async (filename: string): Promise<string> => {
    try {
      return await readFile(join(fullPath, filename), "utf8");
    } catch (_) {
      console.warn(`Could not find ${filename}`);
      return "";
    }
  };
  console.time("running");

  const image = dockerImage || "nygrenh/sandbox-next";
  const command = `docker create --name '${id}' --network none --memory 1G --cpus 1 --cap-drop SETPCAP --cap-drop SETFCAP --cap-drop AUDIT_WRITE --cap-drop SETGID --cap-drop SETUID --cap-drop NET_BIND_SERVICE --cap-drop SYS_CHROOT --cap-drop NET_RAW --mount type=bind,source=${fullPath},target=/app -it ${image} /app/init`;
  console.log(`Creating a container with '${command}'`);
  await exec(command);
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
