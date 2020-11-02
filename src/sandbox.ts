import * as tar from "tar-fs"
import { join, resolve } from "path"
import { createReadStream } from "fs"
import { promisify } from "util"
import winston from "winston"
import { exec as origExec } from "child_process"
import { readFile as origReadFile, unlink as origUnlink } from "fs"
const exec = promisify(origExec)
const readFile = promisify(origReadFile)
const unlink = promisify(origUnlink)

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

const handleSubmission = (
  path: string,
  id: string,
  dockerImage: string | undefined,
  log: winston.Logger,
): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    log.info("Handling submission")
    const outputPath = join("work", id)
    const extractStream = createReadStream(path).pipe(tar.extract(outputPath))
    extractStream.on("finish", async () => {
      log.info("Extracted")
      await exec(`chmod -R 777 ${outputPath}`)
      try {
        await exec(`chmod -R 777 ${outputPath}`)
        const results = await runTests(outputPath, id, dockerImage, log)
        resolve(results)
      } catch (e) {
        log.error(`Error while running: ${e}`)
        reject(e)
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
    })
  })
}

async function runTests(
  path: string,
  submission_id: string,
  dockerImage: string | undefined,
  log: winston.Logger,
): Promise<RunResult> {
  const id = `sandbox-submission-${submission_id}`
  let status = "failed"

  const getFile = async (filename: string): Promise<string> => {
    try {
      return await readFile(join(path, filename), "utf8")
    } catch (_) {
      log.error(`Could not find ${filename}`)
      return ""
    }
  }

  const image = dockerImage || "nygrenh/sandbox-next"
  const command = `docker create --name '${id}' --network none --memory 1G --cpus 1 --cap-drop SETPCAP --cap-drop SETFCAP --cap-drop AUDIT_WRITE --cap-drop SETGID --cap-drop SETUID --cap-drop NET_BIND_SERVICE --cap-drop SYS_CHROOT --cap-drop NET_RAW --mount type=bind,source=${resolve(
    path,
  )},target=/app -it ${image} /app/init`
  log.info(`Creating a container with '${command}'`)
  await exec(command)
  // await exec(`docker cp '${path}/.' '${id}':/app`);
  await exec(`docker cp 'tmc-run' '${id}':/app/tmc-run`)
  await exec(`docker cp 'init' '${id}':/app/init`)
  ensureStops(id, log)
  let vm_log = ""

  const executionStartTime = new Date().getTime()

  try {
    const processLog = await exec(`docker start -i '${id}' | ts -s`)
    vm_log = processLog.stdout + processLog.stderr
    log.info("Ran tests!")
  } catch (e) {
    const executionEndTime = new Date().getTime()
    const durationMs = executionEndTime - executionStartTime
    log.error("Running tests failed", { error: e.message })
    // TODO: handle OOM
    if (durationMs > 1000) {
      status = "timeout"
    } else {
      // TODO: is this the right status
      status = "crashed"
    }
  }

  const test_output = await getFile("test_output.txt")
  const stdout = await getFile("stdout.txt")
  const stderr = await getFile("stderr.txt")
  const valgrind = await getFile("valgrind.log")
  const validations = await getFile("validations.json")
  const exit_code = (await getFile("exit_code.txt")).trim()

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

function ensureStops(id: string, log: winston.Logger) {
  setTimeout(async () => {
    log.info("Making sure process has terminated.")
    try {
      await exec(`docker kill '${id}'`)
      log.info(`Submission ${id} timed out.`)
    } catch (e) {}
  }, 60000)
}

export default handleSubmission
