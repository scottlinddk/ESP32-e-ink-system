export interface NotionConfig {
  token: string;
  databaseId: string;
  dataSourceId?: string;    // required only when the database contains multiple sources
  titleProperty?: string;   // default: infer the database's title property
  statusProperty?: string;  // property name to show as subtitle
  filterStatus?: string;    // only show rows where statusProperty equals this
  maxItems?: number;        // default 4
}

export interface NotionRow {
  id: string;
  title: string;
  subtitle?: string;
}

export interface NotionData {
  rows: NotionRow[];
  databaseName?: string;
}
