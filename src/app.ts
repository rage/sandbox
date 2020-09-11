import Koa from "koa"
import bodyParser from "koa-bodyparser"
import api from "./controllers"
import logger from "./middleware/logger"
import errorHandler from "./middleware/error_handler"
import { CustomContext, CustomState } from "./types"
import cors from "@koa/cors"

const app = new Koa<CustomState, CustomContext>()

app.use(cors())

app.use(errorHandler)

app.use(logger)

app.use(bodyParser())

app.use(api.routes())

export type AppContext = typeof app.context

export default app
