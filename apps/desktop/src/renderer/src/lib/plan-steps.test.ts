import { expect, it } from 'vitest'
import { planSteps, planWithSteps } from './plan-steps'

const plan = 'Goal: migrate\n1. Back up\n   - verify backup\n2. Migrate\n- Risk: downtime\n3. Verify'

it('treats only top-level numbered items as steps', () => {
  expect(planSteps(plan)).toEqual([
    { number: 1, text: 'Back up' },
    { number: 2, text: 'Migrate' },
    { number: 3, text: 'Verify' }
  ])
})

it('removes excluded steps with their nested lines but keeps context', () => {
  expect(planWithSteps(plan, [1])).toBe('Goal: migrate\n2. Migrate\n- Risk: downtime\n3. Verify')
  expect(planWithSteps(plan, [])).toBe(plan)
})
