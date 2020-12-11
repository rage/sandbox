import { Server } from "http"
import Koa from "koa"
import bodyParser from "koa-bodyparser"
import { AddressInfo } from "net"

export interface NotifyResult {
  token: string
  test_output: string
  stdout: string
  stderr: string
  valgrind: string
  validations: string
  vm_log: string
  status: string
  exit_code: string
}

const createResultServer = (
  onResults: (value: NotifyResult) => void,
): string => {
  const app = new Koa()
  app.use(bodyParser())
  let server: Server | null = null

  app.use(async (ctx) => {
    onResults(ctx.request.body)
    ctx.body = "Thanks!"
    setImmediate(() => {
      server?.close()
    })
  })

  server = app.listen(0)

  const address = server.address()

  if (address instanceof String) {
    return address as string
  } else {
    const address2 = address as AddressInfo

    return `http://${address2.address}:${address2.port}}`
  }
}

export default createResultServer
