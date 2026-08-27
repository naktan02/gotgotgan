import type {
  PublishedWriting,
  WritingAttempt,
  WritingCommandOutcome,
} from '../../domain/model.js'

export interface WritingStore {
  apply(attempt: WritingAttempt): Promise<WritingCommandOutcome>
  getPublished(publicationId: string): Promise<PublishedWriting | undefined>
}
