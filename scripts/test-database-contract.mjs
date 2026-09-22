/** Disposable CI databases only. Never point this harness at hospital data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import pg from 'pg';
import express from 'express';
import supertest from 'supertest';

assert.equal(process.env.RUN_DATABASE_CONTRACT, 'synthetic-only', 'Explicit synthetic database opt-in required');
for (const prefix of ['INDICATORS', 'OPENMRS']) {
  assert.equal(process.env[`${prefix}_DB_HOST`], '127.0.0.1', 'Only loopback test services are allowed');
  assert.equal(process.env[`${prefix}_DB_NAME`], 'reportes_sql_test', 'Only the dedicated empty test database is allowed');
}
assert.equal(process.env.AUTO_SEED_DEFAULT_INDICATOR, 'false');
const admin = await mysql.createConnection({
  host: '127.0.0.1', port: Number(process.env.OPENMRS_DB_PORT), database: 'reportes_sql_test',
  user: 'root', password: process.env.MYSQL_TEST_ROOT_PASSWORD, namedPlaceholders: true,
});
const pgAdmin = new pg.Client({
  host: '127.0.0.1', port: Number(process.env.INDICATORS_DB_PORT), database: 'reportes_sql_test',
  user: process.env.INDICATORS_DB_USER, password: process.env.INDICATORS_DB_PASSWORD,
});
await pgAdmin.connect();
let sequelize, disposeMysql;
let ownsDatabases = false;
try {
  const [mysqlTables] = await admin.query('SHOW TABLES');
  const pgTables = await pgAdmin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  assert.equal(mysqlTables.length, 0, 'Refusing nonempty MySQL test database');
  assert.equal(pgTables.rowCount, 0, 'Refusing nonempty PostgreSQL test database');
  ownsDatabases = true;
  await admin.query("CREATE USER 'reportes_reader'@'%' IDENTIFIED BY 'synthetic-reader-only'");
  await admin.query("GRANT SELECT ON reportes_sql_test.* TO 'reportes_reader'@'%'");
  assert.equal(process.env.OPENMRS_DB_USER, 'reportes_reader');
  await admin.query('CREATE TABLE person (person_id INT PRIMARY KEY, birthdate DATE, gender VARCHAR(1), voided INT)');
  await admin.query('CREATE TABLE encounter_type (encounter_type_id INT PRIMARY KEY, uuid VARCHAR(64), retired INT)');
  await admin.query('CREATE TABLE encounter (encounter_id INT PRIMARY KEY, patient_id INT, encounter_type INT, encounter_datetime DATETIME, voided INT)');
  await admin.query('CREATE TABLE concept (concept_id INT PRIMARY KEY, uuid VARCHAR(64))');
  await admin.query('CREATE TABLE encounter_diagnosis (encounter_id INT, diagnosis_coded INT, certainty VARCHAR(32), voided INT)');
  await admin.query("INSERT INTO person VALUES (1,'2025-01-01','F',0),(2,'2025-01-01','M',0),(3,'2025-01-01','F',0)");
  await admin.query("INSERT INTO encounter_type VALUES (1,'type-a',0),(2,'type-b',0)");
  await admin.query("INSERT INTO encounter VALUES (1,1,1,'2026-01-10',0),(2,1,1,'2026-01-20',0),(3,2,2,'2026-01-20',0),(4,3,1,'2026-01-31 23:59:59',0),(5,3,1,'2026-02-01',0)");
  await admin.query("INSERT INTO concept VALUES (1,'diagnosis-a'),(2,'diagnosis-b')");
  await admin.query("INSERT INTO encounter_diagnosis VALUES (1,1,'CONFIRMED',0),(1,2,'CONFIRMED',0),(2,1,'CONFIRMED',0),(3,1,'CONFIRMED',0),(4,1,'CONFIRMED',0),(5,1,'CONFIRMED',0)");

  ({ sequelize } = await import('../dist/database/postgres.js'));
  const mysqlModule = await import('../dist/database/mysql.js');
  ({ disposeMysql } = mysqlModule);
  const { buildQuery } = await import('../dist/engine/interpreter.js');
  const { parseDefinicionIndicador } = await import('../dist/types/definicion.js');
  const { executeAndPersist } = await import('../dist/engine/executor.js');
  const { backfillResultadoCanonical, createRollupViews } = await import('../dist/database/views.js');
  const { Indicador, IndicadorVersion, IndicadorResultado, AppMetadata } = await import('../dist/models/indicador.js');
  const { indicadoresRouter } = await import('../dist/routers/indicadores.js');
  const { resultadosRouter } = await import('../dist/routers/resultados.js');
  await sequelize.sync();
  const start = new Date('2026-01-01'), end = new Date('2026-01-31');
  const definition = { tipo: 'conteo_atenciones', evento: {
    encounter_type_uuids: ['type-a'], diagnosticos: [{ concepto_uuids: ['diagnosis-a', 'diagnosis-b'] }],
  } };
  for (const [tipo, minimum, expected] of [
    ['conteo_atenciones', 1, 3], ['conteo_pacientes', 1, 2],
    ['conteo_atenciones', 2, 2], ['conteo_pacientes', 2, 1], ['conteo_pacientes_ventana', 2, 1],
  ]) {
    const { sql, params } = buildQuery(parseDefinicionIndicador({ ...definition, tipo, evento: { ...definition.evento, minimo_ocurrencias: minimum } }), start, end);
    const rows = await mysqlModule.queryMysql(sql, params);
    assert.equal(Number(rows[0].valor), expected, `${tipo} minimum ${minimum}: filters, duplicate diagnoses and month boundary`);
  }
  // The actual engine connection cannot write source records.
  await assert.rejects(mysqlModule.getMysqlPool().query("INSERT INTO person VALUES (99,'2025-01-01','F',0)"), /denied/i);
  console.log('PASSED: 5 real MariaDB counts, month boundary, diagnosis deduplication and read-only account');

  const indicator = await Indicador.create({ nombre: 'Synthetic migration', descripcion: null });
  const versions = await Promise.all([1, 2].map(version => IndicadorVersion.create({ indicador_id: indicator.id, version, definicion: { tipo: 'conteo_atenciones' } })));
  const seedResult = (version, overrides = {}) => IndicadorResultado.create({
    indicador_version_id: versions[version].id, periodo_inicio: start, periodo_fin: end,
    mes_referencia: start, es_canonico: false, valor: 10, calculado_en: new Date('2026-02-01'), ...overrides,
  });
  const historical = await seedResult(0);
  await seedResult(0, { es_canonico: true });
  const winner = await seedResult(1, { es_canonico: true, calculado_en: new Date('2026-02-02') });
  await seedResult(0, { mes_referencia: null });
  const legacy = await seedResult(1, { periodo_inicio: new Date('2025-12-01'), periodo_fin: new Date('2025-12-31'), mes_referencia: null });
  const snapshot = async () => (await IndicadorResultado.findAll({ order: [['id', 'ASC']] })).map(row => row.toJSON());
  const before = await snapshot();
  await sequelize.query("CREATE FUNCTION reject_marker() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic marker failure'; END $$");
  await sequelize.query('CREATE TRIGGER reject_marker BEFORE INSERT ON app_metadata FOR EACH ROW EXECUTE FUNCTION reject_marker()');
  await assert.rejects(backfillResultadoCanonical(), /synthetic marker failure/);
  assert.deepEqual(await snapshot(), before, 'Migration data rolls back if marker cannot be recorded');
  await sequelize.query('DROP TRIGGER reject_marker ON app_metadata');
  await backfillResultadoCanonical();
  assert.equal((await historical.reload()).es_canonico, false);
  assert.equal((await winner.reload()).es_canonico, true);
  assert.equal((await legacy.reload()).es_canonico, true);
  assert.equal(await IndicadorResultado.count({ where: { es_canonico: true } }), 2);
  assert.equal(await IndicadorResultado.count(), 5, 'No historical rows deleted');
  const migrated = await snapshot();
  await backfillResultadoCanonical();
  assert.deepEqual(await snapshot(), migrated, 'Repeated startup preserves historical state');
  assert.equal(await AppMetadata.count(), 1);
  console.log('PASSED: real PostgreSQL migration rollback, cross-version canonical selection, history preservation and repeat startup');

  await Promise.all(Array.from({ length: 8 }, (_, i) => executeAndPersist('SELECT 7 AS valor', {}, versions[i % 2].id, start, end, start, { indicadorId: indicator.id, fuente: 'synthetic-contract' })));
  assert.equal(await IndicadorResultado.count({ where: { es_canonico: true, mes_referencia: '2026-01-01' } }), 1);
  assert.equal(await IndicadorResultado.count(), 13, 'Concurrent recalculations preserve every historical result');
  await createRollupViews();
  console.log('PASSED: 8 concurrent cross-version calculations yield one canonical month and retain all historical rows');

  const app = express();
  app.use(express.json());
  // Scope: router/ORM contract. Session HTTP validation has separate tests.
  app.use((req, _res, next) => { req.authUser = { uuid: randomUUID(), privileges: [{ name: process.env.OPENMRS_REQUIRED_PRIVILEGE }] }; next(); });
  app.use('/indicadores', indicadoresRouter);
  app.use('/resultados', resultadosRouter);
  app.use((_err, _req, res, _next) => res.status(500).json({ detail: 'Synthetic write rejected' }));
  const countBefore = await Indicador.count();
  await sequelize.query("CREATE FUNCTION reject_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic version failure'; END $$");
  await sequelize.query('CREATE TRIGGER reject_version BEFORE INSERT ON indicador_version FOR EACH ROW EXECUTE FUNCTION reject_version()');
  await supertest(app).post('/indicadores').send({ nombre: 'Synthetic create', definicion: { tipo: 'conteo_atenciones' } }).expect(500);
  assert.equal(await Indicador.count(), countBefore, 'Initial version failure cannot leave an orphan indicator');
  await sequelize.query('DROP TRIGGER reject_version ON indicador_version');
  await sequelize.query("CREATE FUNCTION reject_metadata() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic metadata failure'; END $$");
  await sequelize.query('CREATE TRIGGER reject_metadata BEFORE UPDATE ON indicador FOR EACH ROW EXECUTE FUNCTION reject_metadata()');
  await supertest(app).put(`/indicadores/${indicator.id}`).send({ nombre: 'Synthetic edit', definicion: { tipo: 'conteo_pacientes' } }).expect(500);
  assert.equal(await IndicadorVersion.count({ where: { indicador_id: indicator.id } }), 2, 'Metadata failure rolls back new version');
  await sequelize.query('DROP TRIGGER reject_metadata ON indicador');
  const series = await supertest(app).get('/resultados/series').query({ indicador_id: indicator.id, anio: 2026, granularity: 'trimestral' }).expect(200);
  assert.equal(series.body.items.length, 1);
  assert.equal(series.body.items[0].valor, 7);
  assert.equal(series.body.items[0].meses_disponibles, 1);
  assert.ok(series.body.items[0].versiones.every(value => typeof value === 'number'));
  console.log('PASSED: create/edit rollback with real PostgreSQL and actual aggregate HTTP response contract');
} finally {
  if (disposeMysql) await disposeMysql();
  if (sequelize) await sequelize.close();
  if (ownsDatabases) {
    // Both databases were verified empty before this harness created fixtures.
    await admin.query('DROP TABLE IF EXISTS encounter_diagnosis, concept, encounter, encounter_type, person');
    await admin.query("DROP USER IF EXISTS 'reportes_reader'@'%'");
    await pgAdmin.query('DROP TABLE IF EXISTS indicador_calculo_log, indicador_resultado, indicador_meta, indicador_version, indicador, app_metadata CASCADE');
    await pgAdmin.query('DROP FUNCTION IF EXISTS reject_marker(), reject_version(), reject_metadata()');
    console.log('CLEANUP: synthetic tables, views, functions and MySQL reader removed');
  }
  await admin.end();
  await pgAdmin.end();
}
