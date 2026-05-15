import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { pullAllowedDockerImages } from "./docker-image-maintenance.js";

const logger = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

describe("pullAllowedDockerImages", () => {
  it("pulls alternative images and registry sandbox images", async () => {
    const execFileFn = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          child: ["tmc-sandbox-python", "not-sandbox", "tmc-sandbox-make"],
        }),
        { status: 200 },
      ),
    );

    await pullAllowedDockerImages(logger, { execFileFn, fetchFn });

    expect(fetchFn).toHaveBeenCalledWith("https://eu.gcr.io/v2/moocfi-public/tags/list");
    expect(execFileFn).toHaveBeenCalledWith("docker", ["pull", "nygrenh/sandbox-next"]);
    expect(execFileFn).toHaveBeenCalledWith("docker", [
      "pull",
      "eu.gcr.io/moocfi-public/tmc-sandbox-python",
    ]);
    expect(execFileFn).toHaveBeenCalledWith("docker", [
      "pull",
      "eu.gcr.io/moocfi-public/tmc-sandbox-make",
    ]);
    expect(execFileFn).not.toHaveBeenCalledWith("docker", [
      "pull",
      "eu.gcr.io/moocfi-public/not-sandbox",
    ]);
  });
});
