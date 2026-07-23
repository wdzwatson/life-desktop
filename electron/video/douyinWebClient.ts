import {
  DouyinFavoritesError,
  type DouyinFavoriteFolderInput,
  type DouyinFavoriteItemInput,
  type DouyinFavoritesClient,
  type DouyinPage,
} from './douyinFavorites'
import type { DouyinOfficialPageExecutor } from './douyinOfficialPage'

export const DOUYIN_MY_FAVORITES_FOLDER_ID = 'my-favorites'

const MY_FAVORITES_FOLDER: DouyinFavoriteFolderInput = {
  remoteId: DOUYIN_MY_FAVORITES_FOLDER_ID,
  title: 'My favorites',
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
        entries: cursor ? [] : [MY_FAVORITES_FOLDER],
        hasMore: false,
      }
    },
    async listFolderItems({ folderRemoteId, cursor }) {
      if (folderRemoteId === DOUYIN_MY_FAVORITES_FOLDER_ID) {
        const pageResult = await page.listFavoriteItems({ cursor })
        return pageResult as DouyinPage<DouyinFavoriteItemInput>
      }
      {
        throw new DouyinFavoritesError(
          'unsupported',
          'Only the unified Douyin My favorites collection can be synchronized.',
        )
      }
    },
  }
}
