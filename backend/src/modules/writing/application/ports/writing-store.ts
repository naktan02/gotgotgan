import type {
  PublishedWriting,
  MemberWriting,
  WritingAttempt,
  WritingCommandOutcome,
} from '../../domain/model.js'

export interface WritingStore {
  apply(attempt: WritingAttempt): Promise<WritingCommandOutcome>
  getPublished(publicationId: string): Promise<PublishedWriting | undefined>
  listMemberWriting(memberId: string): Promise<readonly MemberWriting[]>
}
