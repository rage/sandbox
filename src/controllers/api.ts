"use strict";

import * as async from "async";
import * as request from "request";
import { Response, Request, NextFunction } from "express";

import { handleSubmission } from "../sandbox";
import { promisify } from "util";
import { join } from "path";
import * as os from "os";
const unlink = promisify(require("fs").unlink);

const INSTANCES = os.cpus().length;

let busy_instances = 0;

export const ALLOWED_ALTERNATIVE_DOCKER_IMAGES = ["nygrenh/sandbox-next", "eu.gcr.io/moocfi-public/tmc-sandbox-csharp", "eu.gcr.io/moocfi-public/tmc-sandbox-tmc-langs-rust", "eu.gcr.io/moocfi-public/tmc-sandbox-cyber-security-base"];


export const guard = (req: Request, res: Response, next: NextFunction) => {
  if (busy_instances >= INSTANCES) {
    res.status(500).json({ status: "busy" });
    return;
  }
  next();
};

export const tasks = (req: Request, res: Response) => {
  if (busy_instances >= INSTANCES) {
    res.status(500).json({ status: "busy" });
    setImmediate(async () => {
      try {
        await unlink(join("uploads", req.file.filename));
      } catch (e) {
        console.error(`Could not unlink ${req.file.filename}.`, e);
      }
    });
    return;
  }
  busy_instances++;
  console.time("task");
  // console.log(`Received submission ${id}.`);
  console.log(req.file);
  if (req.file.mimetype !== "application/x-tar") {
    res.status(400).json({ error: "Uploaded file was not a tar!" });
    return;
  }

  const dockerImage = req.body.docker_image;
  if (dockerImage && ALLOWED_ALTERNATIVE_DOCKER_IMAGES.indexOf(dockerImage) === -1) {
      res.status(400).json({ error: "Docker image was not whitelisted." });
      return;
  }
  // TODO: Handle when this fails
  handleSubmission(req.file.filename, dockerImage).then(output => {
    busy_instances--;
    console.log("Got output");
    console.log(output);
    console.timeEnd("task");
    console.log(req.body);
    console.log(`Notifying ${req.body.notify}...`);
    request.post(
      {
        url: req.body.notify,
        form: {
          token: req.body.token,
          test_output: output.test_output,
          stdout: output.stdout,
          stderr: output.stderr,
          valgrind: output.valgrind,
          validations: output.validations,
          vm_log: output.vm_log,
          status: output.status,
          exit_code: output.exit_code
        }
      },
      (err: Error) => {
        if (err) {
          console.log(`Failed to notify: ${err}`);
          return;
        }
        console.log("Notified succesfully!");
      }
    );
  }).catch((reason => {
    busy_instances--;
    console.error("Handling submission failed.", reason)
    return res.status(503).json({ error: `Handling message failed. ${reason}`})
  }));
  res.json({ message: "ok" });
};

export const status = (req: Request, res: Response) => {
  res.json({ busy_instances, total_instances: INSTANCES });
};
