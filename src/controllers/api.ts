"use strict";

import * as async from "async";
import * as request from "request";
import { Response, Request, NextFunction } from "express";

import { handleSubmission } from "../sandbox";

const INSTANCES = 10;

let busy_instances = 0;

export const tasks = (req: Request, res: Response) => {
  if (busy_instances >= INSTANCES) {
    res.status(500).json({ status: "busy" });
    return;
  }
  busy_instances++;
  console.time("task");
  // console.log(`Received submission ${id}.`);
  console.log(req.file);
  if (req.file.mimetype !== "application/x-tar") {
    res.json({ error: "Uploaded file was not a tar!" });
    return;
  }
  handleSubmission(req.file.filename).then(output => {
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
          status: "finished"
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
  });
  res.json({ message: "ok" });
};

export const status = (req: Request, res: Response) => {
  res.json({ busy_instances, total_instances: INSTANCES });
};
