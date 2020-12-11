import http from "http"
import { GlobalLogger } from "./src/middleware/logger"
import app from "./src/app"
import { ALLOWED_ALTERNATIVE_DOCKER_IMAGES } from "./src/controllers"
import Axios from "axios"
import { promisify } from "util"
import { exec as origExec } from "child_process"
const exec = promisify(origExec)

const port = process.env.PORT || 3232

http
  .createServer(app.callback())
  .listen(port, () => GlobalLogger.info(`Server running on port ${port}.`))

async function pullImage(image: string) {
  GlobalLogger.info("Pulling " + image)
  try {
    await exec(`docker pull ${image}`)
  } catch (e) {
    GlobalLogger.error(`Could not pull image ${image}`, e)
  }
}

setInterval(async () => {
  for (const image of ALLOWED_ALTERNATIVE_DOCKER_IMAGES) {
    await pullImage(image)
  }

  GlobalLogger.info("Getting a list of all alternative images")
  const res = await Axios.get("https://eu.gcr.io/v2/moocfi-public/tags/list")
  const images = res.data.child
  if (images && images instanceof Array) {
    for (const image of images.filter((o) => o.startsWith("tmc-sandbox-"))) {
      await pullImage(`eu.gcr.io/moocfi-public/${image}`)
    }
  }
}, 10 * 60 * 1000)

setInterval(() => {
  GlobalLogger.info(`Pruning old images that have not been used for 24 hours.`)
  exec('docker image prune -a --filter "until=24h"')
}, 24 * 60 * 60 * 1000)
