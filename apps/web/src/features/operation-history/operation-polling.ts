import {
  createPollController,
  type PollController,
  type PollOptions,
} from '../../shared/async/poll-controller'

import { OperationHistoryProblem } from './operation-history-model'

export type OperationPollController = PollController

export function isTerminalOperationPollingError(error: unknown): boolean {
  return error instanceof OperationHistoryProblem && (error.status === 401 || error.status === 403)
}

export function createOperationPollController<T>(options: PollOptions<T>): OperationPollController {
  return createPollController({ ...options, isTerminalError: isTerminalOperationPollingError })
}
