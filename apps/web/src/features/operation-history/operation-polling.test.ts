import { describe, expect, it } from 'vitest'

import { OperationHistoryProblem } from './operation-history-model'
import { isTerminalOperationPollingError } from './operation-polling'

describe('operation polling error policy', () => {
  it('stops only for authentication and authorization failures', () => {
    expect(isTerminalOperationPollingError(new OperationHistoryProblem(401))).toBe(true)
    expect(isTerminalOperationPollingError(new OperationHistoryProblem(403))).toBe(true)
    expect(isTerminalOperationPollingError(new OperationHistoryProblem(503))).toBe(false)
    expect(isTerminalOperationPollingError(new Error('temporary'))).toBe(false)
  })
})
