/** Top-level numbered items ("1. ...") are the plan's steps; indented lines
 * under a step belong to it. Bullets and prose are context, never steps. */
const STEP = /^(\d+)\.\s+(.*)$/

export function planSteps(plan: string): { number: number; text: string }[] {
  return plan.split('\n').flatMap((line) => {
    const match = STEP.exec(line)
    return match ? [{ number: Number(match[1]), text: match[2].trim() }] : []
  })
}

/** Drops excluded steps (and their indented sub-lines) from the plan text. */
export function planWithSteps(plan: string, excluded: number[]): string {
  if (excluded.length === 0) return plan
  let skipping = false
  return plan
    .split('\n')
    .filter((line) => {
      const match = STEP.exec(line)
      if (match) skipping = excluded.includes(Number(match[1]))
      else if (line.trim() && !/^\s/.test(line)) skipping = false
      return !skipping
    })
    .join('\n')
}
