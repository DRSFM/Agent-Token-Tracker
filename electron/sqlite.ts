import sqlite3 from 'sqlite3'

export async function querySqliteRows<T>(
  dbPath: string,
  sql: string,
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError)
        return
      }

      database.configure('busyTimeout', 3_000)
      database.all(sql, (queryError, rows) => {
        database.close((closeError) => {
          if (queryError) reject(queryError)
          else if (closeError) reject(closeError)
          else resolve((rows || []) as T[])
        })
      })
    })
  })
}
