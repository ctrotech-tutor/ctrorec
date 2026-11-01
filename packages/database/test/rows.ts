export function exactlyOne<T>(rows: T[]): T {
  const row = rows[0]
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Expected exactly one row; received ${rows.length}.`)
  }
  return row
}

export function exactlyTwo<T>(rows: T[]): [T, T] {
  const first = rows[0]
  const second = rows[1]
  if (rows.length !== 2 || first === undefined || second === undefined) {
    throw new Error(`Expected exactly two rows; received ${rows.length}.`)
  }
  return [first, second]
}
