'use client'

import type {
  LibraryCollectionListResponse,
  LibraryTagListResponse,
} from '@place/contracts/library'

import { usePersonalCollectionManagementWorkflow } from './personal-collection-management-workflow'
import { usePersonalLibraryManagementMutation } from './personal-library-management-mutation'
import { usePersonalTagManagementWorkflow } from './personal-tag-management-workflow'

type ManagementWorkflowInput = Readonly<{
  active: boolean
  collections: LibraryCollectionListResponse['items']
  tags: LibraryTagListResponse['items']
  metadataLoading: boolean
  collectionCursor?: string
  tagCursor?: string
  loadMoreCollections: () => void | Promise<unknown>
  loadMoreTags: () => void | Promise<unknown>
  refreshMetadata: () => Promise<unknown>
  onAccessFailure: (reason: unknown) => void
  onCollectionDeleted: (collectionId: string) => void
  onTagDeleted: (tagId: string) => void
}>

export function usePersonalLibraryManagementWorkflow(input: ManagementWorkflowInput) {
  const mutation = usePersonalLibraryManagementMutation({
    onAccessFailure: input.onAccessFailure,
    refreshMetadata: input.refreshMetadata,
  })
  const collectionWorkflow = usePersonalCollectionManagementWorkflow({
    active: input.active,
    collections: input.collections,
    collectionCursor: input.collectionCursor,
    execute: mutation.executeManagementMutation,
    loadMoreCollections: input.loadMoreCollections,
    refreshMetadata: input.refreshMetadata,
    onAccessFailure: input.onAccessFailure,
    onCollectionDeleted: input.onCollectionDeleted,
  })
  const tagWorkflow = usePersonalTagManagementWorkflow({
    tags: input.tags,
    tagCursor: input.tagCursor,
    execute: mutation.executeManagementMutation,
    loadMoreTags: input.loadMoreTags,
    refreshMetadata: input.refreshMetadata,
    onTagDeleted: input.onTagDeleted,
  })
  const { collectionError, ...collection } = collectionWorkflow

  return {
    management: {
      metadataLoading: input.metadataLoading,
      collection,
      tag: tagWorkflow,
      mutation: {
        key: mutation.mutationKey,
        error: mutation.managementMutationError ?? collectionError,
        canRetry: mutation.canRetryManagementMutation,
        retry: mutation.retryManagementMutation,
      },
    },
  }
}

export type PersonalLibraryManagement = ReturnType<
  typeof usePersonalLibraryManagementWorkflow
>['management']
export type PersonalCollectionManagement = PersonalLibraryManagement['collection']
export type PersonalTagManagement = PersonalLibraryManagement['tag']
