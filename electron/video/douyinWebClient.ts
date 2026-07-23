import {
  DouyinFavoritesError,
  type DouyinFavoriteFolderInput,
  type DouyinFavoriteItemInput,
  type DouyinFavoritesClient,
  type DouyinPage,
} from './douyinFavorites'
import type { DouyinOfficialPageExecutor } from './douyinOfficialPage'

export const DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID = 'my-favorite-videos'

const MY_FAVORITE_VIDEOS_FOLDER: DouyinFavoriteFolderInput = {
  remoteId: DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID,
  title: 'My favorite videos',
}

/** Adapts the visible "My favorites > Videos" page into the local mirror client. */
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
        entries: cursor ? [] : [MY_FAVORITE_VIDEOS_FOLDER],
        hasMore: false,
      }
    },
    async listFolderItems({ folderRemoteId, cursor }) {
      if (folderRemoteId !== DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID) {
        throw new DouyinFavoritesError(
          'unsupported',
          'Only Douyin My favorites videos can be synchronized.',
        )
      }
      const pageResult = await page.listFavoriteVideos({ cursor })
      return pageResult as DouyinPage<DouyinFavoriteItemInput>
    },
  }
}
