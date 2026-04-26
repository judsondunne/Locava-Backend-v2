import {
  SearchUsersRepository,
  type SearchUsersPageRecord
} from "./search-users.repository.js";

export class DirectoryUsersRepository {
  constructor(private readonly searchUsersRepository: SearchUsersRepository = new SearchUsersRepository()) {}

  getDirectoryUsersPage(input: {
    query: string;
    cursor: string | null;
    limit: number;
    excludeUserIds: string[];
  }): Promise<SearchUsersPageRecord> {
    return this.searchUsersRepository.getSearchUsersPage(input);
  }

  getViewerFollowingUserIds(viewerId: string, userIds: string[]): Promise<string[]> {
    return this.searchUsersRepository.getViewerFollowingUserIds(viewerId, userIds);
  }
}
