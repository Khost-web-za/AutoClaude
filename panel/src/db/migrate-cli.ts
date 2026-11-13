import { runMigrations } from './migrate';

runMigrations().then(
  () => console.log('Migrations applied'),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
