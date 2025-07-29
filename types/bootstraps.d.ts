import { File } from "./file"

export interface IBootstraps {
  winFile: File | null
  macFile: File | null
  linFile: File | null
  version: string
}
