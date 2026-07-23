import {
  DouyinFavoritesError,
  type DouyinFavoriteFolderInput,
  type DouyinFavoriteItemInput,
  type DouyinFavoritesClient,
  type DouyinPage,
} from './douyinFavorites'
import type { DouyinOfficialPageExecutor } from './douyinOfficialPage'

export const DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID = 'my-favorite-videos'
export const DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID = 'my-favorite-notes'

const MY_FAVORITE_VIDEOS_FOLDER: DouyinFavoriteFolderInput = {
  remoteId: DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID,
  title: 'My favorite videos',
}

const MY_FAVORITE_NOTES_FOLDER: DouyinFavoriteFolderInput = {
  remoteId: DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID,
  title: 'My favorite notes',
}

/** Adapts the visible My favorites tabs into the local mirror client. */
export function createDouyinWebFavoritesClient(
  page: DouyinOfficialPageExecutor,
): DouyinFavoritesClient {
  return {
    async getAccountProfile() {
      if (!(await page.isLoggedIn())) {
        throw new DouyinFavoritesError(
          'auth_required',
          'Douyin login has expired. Please sign in again.',
        )
      }
      return {}
    },
    async listFolders({ cursor }) {
      return {
        entries: cursor ? [] : [MY_FAVORITE_VIDEOS_FOLDER, MY_FAVORITE_NOTES_FOLDER],
        hasMore: false,
      }
    },
    async listFolderItems({ folderRemoteId, cursor }) {
      if (folderRemoteId === DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID) {
        const pageResult = await page.listFavoriteVideos({ cursor })
        return pageResult as DouyinPage<DouyinFavoriteItemInput>
      }
      if (folderRemoteId === DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID) {
        const pageResult = await page.listFavoriteNotes({ cursor })
        return pageResult as DouyinPage<DouyinFavoriteItemInput>
      }
      {
        throw new DouyinFavoritesError(
          'unsupported',
          'Only Douyin My favorites videos and notes can be synchronized.',
        )
      }
    },
  }
}
