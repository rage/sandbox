import type { z } from "zod";
import type {
  MimeTypeSchema,
  ResourceLimitsSchema,
  StatusResponseSchema,
  TaskResponseSchema,
} from "./schemas.js";

export type DockerRuntime = "runc" | "runsc";
export type SupportedMimeType = z.infer<typeof MimeTypeSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;

export interface SubmissionResult {
  testOutput: string;
  stdout: string;
  stderr: string;
  valgrind: string;
  validations: string;
  vmLog: string;
  status: "finished" | "timeout" | "crashed" | "out-of-memory" | "failed";
  exitCode: string;
}
