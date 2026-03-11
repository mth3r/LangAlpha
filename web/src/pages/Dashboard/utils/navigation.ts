/**
 * Shared navigation for news/infoflow items.
 * News articles navigate to /news/:id, infoflow items to /detail/:indexNumber.
 */

export interface NewsItem {
  id?: string;
  indexNumber?: string | number;
  [key: string]: unknown;
}

export function navigateToNewsItem(navigate: (path: string) => void, item: NewsItem): void {
  if (item.id) {
    navigate(`/news/${item.id}`);
  } else if (item.indexNumber) {
    navigate(`/detail/${item.indexNumber}`);
  }
}
