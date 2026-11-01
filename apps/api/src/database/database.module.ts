import {
  createDatabase,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DATABASE, DATABASE_CONNECTION } from './database.constants.js'

interface DatabaseConnection {
  db: Database
  pool: DatabasePool
}

@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(private readonly connection: DatabaseConnection) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end()
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DatabaseConnection =>
        createDatabase(config.getOrThrow<string>('DATABASE_URL'), {
          applicationName: 'ctrorec-api',
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: DatabaseConnection) => connection.db,
    },
    {
      provide: DatabaseLifecycle,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: DatabaseConnection) =>
        new DatabaseLifecycle(connection),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
