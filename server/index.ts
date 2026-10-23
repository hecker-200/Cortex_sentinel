import { mkdirSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb, migrate } from './db';
import { seedCases } from './seed';

const cfg = loadConfig();
if (cfg.dataDir) mkdirSync(cfg.dataDir, { recursive: true });

const db = await createDb({ url: cfg.databaseUrl, dataDir: cfg.dataDir });
await migrate(db);
const seeded = await seedCases(db, cfg.seedDir);
if (seeded) console.log(`Seeded ${seeded} draft cases from ${cfg.seedDir}`);

const server = createApp(db, cfg).listen(cfg.port, () => {
  console.log(`CORTEX listening on http://localhost:${cfg.port} (database: ${db.kind}${cfg.dataDir ? ` at ${cfg.dataDir}` : ''})`);
});

const shutdown = () => {
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
