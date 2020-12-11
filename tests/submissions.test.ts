import { Server } from "http"
import request from "supertest"
import App from "../src/app"
import createResultServer, { NotifyResult } from "./util/createResultsServer"

let server: Server | null = null

beforeAll(() => {
  server = App.listen(0)
})

afterAll(() => {
  server?.close()
})

test("GET /status.json returns the current status", async () => {
  const res = await request(server)
    .get("/status.json")
    .expect("Content-Type", /json/)
    .expect(200)

  expect(res.body.busy_instances).toBe(0)
  expect(res.body.total_instances).toBeGreaterThan(0)
})

test("POST /tasks.json works", async () => {
  jest.setTimeout(60000)
  const notifyResult: NotifyResult = await new Promise(
    async (resolve, _reject) => {
      const notifyAddress = createResultServer((res) => {
        resolve(res)
      })

      await request(server)
        .post("/tasks.json")
        .attach("file", "tests/data/submission.tar")
        .field(
          "docker_image",
          "eu.gcr.io/moocfi-public/tmc-sandbox-tmc-langs-rust",
        )
        .field("token", "SUPER_SECERET")
        .field("notify", notifyAddress)
        .set("Accept", "application/json")
        .expect("Content-Type", /json/)
        .expect(200)
    },
  )
  expect(notifyResult.token).toBe("SUPER_SECERET")
  expect(notifyResult.exit_code).toBe("0")
  expect(notifyResult.status).toBe("finished")
  expect(notifyResult.vm_log.length).toBeGreaterThan(5)
  const testOutput = JSON.parse(notifyResult.test_output)
  expect(testOutput.status).toBe("PASSED")
  expect(testOutput.testResults.length).toBe(1)
})

test("POST /tasks.json works with .tar.zst files", async () => {
  jest.setTimeout(60000)
  const notifyResult: NotifyResult = await new Promise(
    async (resolve, _reject) => {
      const notifyAddress = createResultServer((res) => {
        resolve(res)
      })

      await request(server)
        .post("/tasks.json")
        .attach("file", "tests/data/submission.tar.zst", {
          contentType: "application/zstd",
        })
        .field(
          "docker_image",
          "eu.gcr.io/moocfi-public/tmc-sandbox-tmc-langs-rust",
        )
        .field("token", "SUPER_SECERET")
        .field("notify", notifyAddress)
        .set("Accept", "application/json")
        .expect("Content-Type", /json/)
        .expect(200)
    },
  )

  expect(notifyResult.token).toBe("SUPER_SECERET")
  expect(notifyResult.exit_code).toBe("0")
  expect(notifyResult.status).toBe("finished")
  expect(notifyResult.vm_log.length).toBeGreaterThan(5)
  const testOutput = JSON.parse(notifyResult.test_output)
  expect(testOutput.status).toBe("PASSED")
  expect(testOutput.testResults.length).toBe(1)
})

test("POST /tasks.json does not crash with fork bombs", async () => {
  jest.setTimeout(60000)
  const notifyResult: NotifyResult = await new Promise(
    async (resolve, _reject) => {
      const notifyAddress = createResultServer((res) => {
        resolve(res)
      })

      await request(server)
        .post("/tasks.json")
        .attach("file", "tests/data/fork-bomb.tar.zst", {
          contentType: "application/zstd",
        })
        .field(
          "docker_image",
          "eu.gcr.io/moocfi-public/tmc-sandbox-tmc-langs-rust",
        )
        .field("token", "SUPER_SECERET")
        .field("notify", notifyAddress)
        .set("Accept", "application/json")
        .expect("Content-Type", /json/)
        .expect(200)
    },
  )

  expect(notifyResult.token).toBe("SUPER_SECERET")

  // hard to predict what happens in this case
  const case1 =
    notifyResult.status === "finished" &&
    notifyResult.test_output.indexOf("TESTS_FAILED") !== -1

  const case2 =
    notifyResult.status === "failed" && notifyResult.exit_code === "110"

  expect(case1 || case2).toBe(true)
})

test("POST /tasks.json works when submission uses too much memory", async () => {
  jest.setTimeout(60000)
  const notifyResult: NotifyResult = await new Promise(
    async (resolve, _reject) => {
      const notifyAddress = createResultServer((res) => {
        resolve(res)
      })

      await request(server)
        .post("/tasks.json")
        .attach("file", "tests/data/out-of-memory.tar.zst", {
          contentType: "application/zstd",
        })
        .field(
          "docker_image",
          "eu.gcr.io/moocfi-public/tmc-sandbox-tmc-langs-rust",
        )
        .field("token", "SUPER_SECERET")
        .field("notify", notifyAddress)
        .set("Accept", "application/json")
        .expect("Content-Type", /json/)
        .expect(200)
    },
  )
  expect(notifyResult.token).toBe("SUPER_SECERET")
  expect(notifyResult.status).toBe("out-of-memory")
})
