export interface INews {
  id?: number
  title: string
  content: string
  author: number
  date: Date
  edition_date?: Date | null
  categories?: number[] | string
  tags?: number[] | string
}

export interface INewsCategory {
  id?: number
  title: string
  date: string
}

export interface NewsCategoryRes extends INewsCategory {
  news: INews[]
}

export interface INewsTag {
  id?: number
  title: string
  color: string
}
