import { File } from './file'

export interface IBackground {
  success: true
  name: string
  status: 'ACTIVE'
  createdAt: Date
  updatedAt: Date
  file: File
}
