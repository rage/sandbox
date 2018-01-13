import { assert } from "jest";
import * as supertest from "supertest";

const request = supertest("http://localhost:3231");

describe("GET /status.json", () => {
  it("should return 200 OK", async () => {
    const response = await request.get("/status.json").expect(200);
  });
});
