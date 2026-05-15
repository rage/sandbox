import * as tar from "tar-fs"
import { createReadStream, mkdir as origMkdir } from "fs"
import { promisify } from "util"
import { exec as origExec } from "child_process"
const exec = promisify(origExec)
const mkdir = promisify(origMkdir)

export type SupportedMimeTypes = "application/x-tar" | "application/zstd"

const extractTar = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const extractStream = createReadStream(inputPath).pipe(
      tar.extract(outputPath),
    )
    extractStream?.on("finish", () => {
      resolve()
    })
    extractStream.on("error", (reason) => {
      reject(reason)
    })
  })
}

const extractZstd = async (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  // Tar expects the output directory to exist
  await mkdir(outputPath, { recursive: true })
  await exec(`tar -I zstd -xvf '${inputPath}' --directory '${outputPath}'`)
}

const extract = async (
  inputPath: string,
  outputPath: string,
  mimetype: SupportedMimeTypes,
): Promise<void> => {
  if (mimetype === "application/zstd") {
    await extractZstd(inputPath, outputPath)
  } else {
    await extractTar(inputPath, outputPath)
  }
}

export default extract
