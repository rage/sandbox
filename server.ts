import http from "http"
import { GlobalLogger } from "./src/middleware/logger"
import app from "./src/app"
import { ALLOWED_ALTERNATIVE_DOCKER_IMAGES } from "./src/controllers"
import Axios from "axios"
import { promisify } from "util"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const exec = promisify(require("child_process").exec)

const port = process.env.PORT || 3231

http
  .createServer(app.callback())
  .listen(port, () => GlobalLogger.info(`Server running on port ${port}.`))

async function pullImage(image: string) {
  console.log("Pulling " + image)
  try {
    await exec(`docker pull ${image}`)
  } catch (e) {
    console.error(`Could not pull image ${image}`, e)
  }
}

setInterval(async () => {
  for (const image of ALLOWED_ALTERNATIVE_DOCKER_IMAGES) {
    await pullImage(image)
  }

  console.log("Getting a list of all alternative images")
  const res = await Axios.get("https://eu.gcr.io/v2/moocfi-public/tags/list")
  const images = res.data.child
  if (images && images instanceof Array) {
    for (const image of images.filter(o => o.startsWith("tmc-sandbox-"))) {
      await pullImage(image)
    }
  }
}, 10 * 60 * 1000)

setInterval(() => {
  exec('docker image prune -a --filter "until=24h"')
}, 24 * 60 * 60 * 1000)
