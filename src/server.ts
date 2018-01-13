import * as express from "express";
import * as compression from "compression"; // compresses requests
import * as bodyParser from "body-parser";
import * as logger from "morgan";
import * as errorHandler from "errorhandler";
import * as dotenv from "dotenv";
import * as path from "path";
import * as multer from "multer";
const upload = multer({ dest: "uploads/" });

/**
 * Load environment variables from .env file, where API keys and passwords are configured.
 */
dotenv.config({ path: ".env.example" });

/**
 * Controllers (route handlers).
 */
import * as homeController from "./controllers/home";
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
app.get("/", homeController.index);
app.post("/tasks.json", upload.single("file"), apiController.tasks);
app.get("/status.json", apiController.status);

/**
 * Start Express server.
 */
app.listen(app.get("port"), () => {
  console.log(
    "  App is running at http://localhost:%d in %s mode",
    app.get("port"),
    app.get("env")
  );
  console.log("  Press CTRL-C to stop\n");
});

module.exports = app;