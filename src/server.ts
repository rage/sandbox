import * as express from "express";
import * as compression from "compression"; // compresses requests
import * as bodyParser from "body-parser";
import * as logger from "morgan";
import * as errorHandler from "errorhandler";
import * as dotenv from "dotenv";
import * as path from "path";
import * as multer from "multer";
import { promisify } from "util";
const upload = multer({ dest: "uploads/" });
const exec = promisify(require("child_process").exec);

/**
 * Load environment variables from .env file, where API keys and passwords are configured.
 */
dotenv.config({ path: ".env.example" });

/**
 * Controllers (route handlers).
 */
import * as apiController from "./controllers/api";

/**
 * Create Express server.
 */
const app = express();

/**
 * Express configuration.
 */
app.set("port", process.env.PORT || 3231);
app.use(compression());
app.use(logger("dev"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/**
 * Primary app routes.
 */
app.post("/tasks.json", upload.single("file"), apiController.tasks);
app.get("/status.json", apiController.status);

const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

/**
 * Start Express server.
 */
app.listen(app.get("port"), host, () => {
  console.log(
    `  App is running at http://${host}:${app.get("port")} in ${app.get(
      "env"
    )} mode`
  );
  console.log("  Press CTRL-C to stop\n");
});

setInterval(() => {
  apiController.ALLOWED_ALTERNATIVE_DOCKER_IMAGES.forEach(async (image) => {
    try {
      await exec(`docker pull ${image}`)
    } catch (e) {
      console.error(`Could not pull image ${image}`, e)
    }
  })
}, 10*60*1000)

module.exports = app;
