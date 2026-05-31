/**
 * PostgreSQL database (Sequelize) — indicators read/write.
 *
 * Sequelize 6 with the `pg` driver. All models share this Sequelize instance.
 * sequelize.authenticate() is called lazily; the instance is exported for
 * model definition and queries.
 */

import { Sequelize } from "sequelize";
import { getIndicadoresDatabaseUrl } from "../config/index.js";

const databaseUrl = getIndicadoresDatabaseUrl();

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    timestamps: false, // We manage createdAt/updatedAt manually
    underscored: false,
  },
});

/**
 * Test the PostgreSQL connection.
 * Returns true if connected, false otherwise.
 */
export async function testPostgresConnection(): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch {
    return false;
  }
}

/**
 * Dispose the Sequelize connection pool on shutdown.
 */
export async function disposePostgres(): Promise<void> {
  await sequelize.close();
}
