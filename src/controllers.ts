import Router from "koa-router"
import { CustomContext, CustomState } from "./types"
import multer from "@koa/multer"
import gateKeeper, {
  INSTANCES,
  getBusyInstances,
  freeInstance,
} from "./middleware/gatekeeper"
import { BadRequestError } from "./util/error"
import handleSubmission, { RunResult } from "./sandbox"
import Axios from "axios"
import { SupportedMimeTypes } from "./util/file_extractor"

const upload = multer({ dest: "uploads/" })
export const ALLOWED_ALTERNATIVE_DOCKER_IMAGES = ["nygrenh/sandbox-next"]
const ALLOWED_DOCKER_IMAGE_PREFIX = "eu.gcr.io/moocfi-public/tmc-sandbox-"

const api = new Router<CustomState, CustomContext>()
  .get("/status.json", async (ctx) => {
    ctx.body = {
      busy_instances: getBusyInstances(),
      total_instances: INSTANCES,
    }
  })

  .post("/tasks.json", gateKeeper, upload.single("file"), async (ctx) => {
    // Gatekeeper has already reserved a processing instance for us.
    // We must remember to free it once we're done. We're limiting the number of
    // concurrent tasks in a middleware because we want to do it before receiving
    // the uploaded file.

    if (
      ctx.file.mimetype !== "application/x-tar" &&
      ctx.file.mimetype !== "application/zstd"
    ) {
      freeInstance()
      throw new BadRequestError(
        `Uploaded file type is not supported! Mimetype was: ${ctx.file.mimetype}}. Supported types are application/x-tar and application/zstd.`,
      )
    }

    const dockerImage: string = ctx.request.body.docker_image
    if (
      dockerImage &&
      !(
        dockerImage.startsWith(ALLOWED_DOCKER_IMAGE_PREFIX) ||
        ALLOWED_ALTERNATIVE_DOCKER_IMAGES.indexOf(dockerImage) !== -1
      )
    ) {
      freeInstance()
      throw new BadRequestError("Docker image was not whitelisted.")
    }

    if (ctx.request.body.submission_id) {
      ctx.log.info(`Handling submission ${ctx.request.body.submission_id}.`)
    }

    // The actual processing is done asynchronously
    setImmediate(async () => {
      try {
        let output: RunResult
        try {
          output = await handleSubmission(
            ctx.file.path,
            ctx.requestId,
            dockerImage,
            ctx.log.child({ async: true }),
            ctx.file.mimetype as SupportedMimeTypes,
          )
        } catch (reason1) {
          ctx.log.error("Handling submission failed.", { reason: reason1 })
          return
        } finally {
          freeInstance()
        }

        ctx.log.info(`Notifying ${ctx.request.body.notify}...`, {
          status: output.status,
        })
        await Axios.post(ctx.request.body.notify, {
          token: ctx.request.body.token,
          test_output: output.test_output,
          stdout: output.stdout,
          stderr: output.stderr,
          valgrind: output.valgrind,
          validations: output.validations,
          vm_log: output.vm_log,
          status: output.status,
          exit_code: output.exit_code,
        })
      } catch (reason2) {
        ctx.log.error("Notifying failed", { error: reason2.message })
      }
    })

    ctx.body = { message: "ok" }
  })

export default api
