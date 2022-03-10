import { join, resolve } from "path"
import { promisify } from "util"
import winston from "winston"
import { exec as origExec } from "child_process"
import { readFile as origReadFile, unlink as origUnlink } from "fs"
import extract, { SupportedMimeTypes } from "./util/file_extractor"
const exec = promisify(origExec)
const readFile = promisify(origReadFile)
const unlink = promisify(origUnlink)

const DEFAULT_TASK_TIMEOUT_MS = 60000

export interface RunResult {
  test_output: string
  stdout: string
  stderr: string
  valgrind: string
  validations: string
  vm_log: string
  status: string
  exit_code: string
}

const handleSubmission = async (
  path: string,
  id: string,
  dockerImage: string | undefined,
  log: winston.Logger,
  mimetype: SupportedMimeTypes,
): Promise<RunResult> => {
  log.info("Handling submission")
  const outputPath = join("work", id)
  await extract(path, outputPath, mimetype)

  log.info("Extracted")
  await exec(`chmod -R 777 ${outputPath}`)
  try {
    await exec(`chmod -R 777 ${outputPath}`)
    const results = await runTests(outputPath, id, dockerImage, log)
    return results
  } catch (e) {
    log.error(`Error while running: ${e}`)
    throw e
  } finally {
    setImmediate(async () => {
      try {
        await unlink(path)
        await exec(`rm -rf '${outputPath}'`)
      } catch (e) {
        log.error(`Could not clean up ${id}.`, e)
      }
    })
  }
}

async function runTests(
  path: string,
  submission_id: string,
  dockerImage: string | undefined,
  log: winston.Logger,
): Promise<RunResult> {
  const id = `sandbox-submission-${submission_id}`
  let status = "failed"
  const timeout_ms = DEFAULT_TASK_TIMEOUT_MS

  const getFile = async (filename: string): Promise<string> => {
    try {
      return await readFile(join(path, filename), "utf8")
    } catch (_) {
      log.warn(`Could not find ${filename}`)
      return ""
    }
  }

  const image = dockerImage || "nygrenh/sandbox-next"
  const command = `docker create --name '${id}' --network none --memory 2G --kernel-memory=50M --pids-limit=200 --ulimit nproc=10000:10000 --cpus 1 --cap-drop SETPCAP --cap-drop SETFCAP --cap-drop AUDIT_WRITE --cap-drop SETGID --cap-drop SETUID --cap-drop NET_BIND_SERVICE --cap-drop SYS_CHROOT --cap-drop NET_RAW --mount type=bind,source=${resolve(
    path,
  )},target=/app -it '${image}' /app/init`
  log.info(`Creating a container with '${command}'`)
  await exec(command)
  // await exec(`docker cp '${path}/.' '${id}':/app`);
  await exec(`docker cp 'tmc-run' '${id}':/app/tmc-run`)
  await exec(`docker cp 'init' '${id}':/app/init`)
  let vm_log = ""

  ensureStops(id, log, timeout_ms)
  const executionStartTime = new Date().getTime()
  let exit_code = ""

  try {
    const processLog = await exec(`docker start -i '${id}' | ts -s`)
    vm_log = processLog.stdout + processLog.stderr
    log.info("Ran tests!")
    exit_code = (await getFile("exit_code.txt")).trim()
    if (!exit_code || exit_code === "") {
      // If there is no exit code, tmc-run didn't finish
      throw new Error("tmc-run did not exit")
    }
  } catch (e) {
    const executionEndTime = new Date().getTime()
    const durationMs = executionEndTime - executionStartTime
    log.error("Running tests failed", { error: e.message })
    // If the process died within the last 5 seconds before timeout, it was
    // likely a timeout.
    if (durationMs > timeout_ms - 5000) {
      status = "timeout"
    } else {
      // TODO: is this the right status
      status = "crashed"
    }
  }
  try {
    log.info(`Trying to inspect the container`)
    const inspection = await exec(`docker inspect '${id}'`)
    const info = JSON.parse(inspection.stdout)
    const oomKilled = info[0].State.OOMKilled
    if (oomKilled) {
      status = "out-of-memory"
    }
  } catch (e) {
    log.error("Could not inspect the container", e)
  }

  const [
    test_output,
    stdout,
    stderr,
    valgrind,
    validations,
  ] = await Promise.all([
    getFile("test_output.txt"),
    getFile("stdout.txt"),
    getFile("stderr.txt"),
    getFile("valgrind.log"),
    getFile("validations.json"),
  ])

  log.info("Result files read", { exit_code })
  if (process.env.PRINT_VM_LOG) {
    console.log(vm_log)
  }

  if (status !== "timeout" && exit_code === "0") {
    status = "finished"
  }

  setImmediate(async () => {
    await exec(`docker rm --force '${id}'`)
  })

  return {
    test_output,
    stdout,
    stderr,
    valgrind,
    validations,
    vm_log,
    exit_code,
    status,
  }
}

function ensureStops(id: string, log: winston.Logger, timeout_ms: number) {
  setTimeout(async () => {
    log.info("Making sure process has terminated.")
    try {
      await exec(`docker kill '${id}'`)
      log.info(`Submission ${id} timed out.`)
    } catch (e) {}
  }, timeout_ms)
}

export default handleSubmission
