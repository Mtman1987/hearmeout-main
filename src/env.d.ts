declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }
  interface Statement {
    bind(params?: any[]): void;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }
  export type Database = Database;
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}

namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_LIVEKIT_URL: string;
    LIVEKIT_API_KEY: string;
    LIVEKIT_API_SECRET: string;
  }
}
