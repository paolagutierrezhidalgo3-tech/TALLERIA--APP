#!/usr/bin/env node
// Runs a single read-only statement against the real Supabase database named
// by TALLERIA_DB_URL and prints the rows. Refuses anything that doesn't
// start with select/with/explain/show, so this script physically cannot be
// used to modify real data, even by mistake -- unlike apply-migration.mjs,
// there is no --confirm escape hatch here on purpose.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

// Supabase's pooler chains to its own private root CA ("Supabase Root 2021 CA"),
// which isn't in Node's default trust store. Pinning it here lets us keep
// rejectUnauthorized: true instead of disabling TLS verification outright.
const supabasePoolerCa = readFileSync(
  fileURLToPath(new URL('./certs/supabase-pooler-root-ca.pem', import.meta.url)),
  'utf8'
);

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('Uso: node scripts/db-query.mjs "select ..."');
  process.exit(1);
}
if (!/^(select|with|explain|show)\b/i.test(sql)) {
  console.error('Solo se permiten consultas de lectura (select/with/explain/show). Para cambios reales usa apply-migration.mjs, con confirmación explícita.');
  process.exit(1);
}
const url = process.env.TALLERIA_DB_URL;
if (!url) {
  console.error('Falta la variable de entorno TALLERIA_DB_URL (revisa que esté configurada y que hayas reiniciado Claude Code después de crearla).');
  process.exit(1);
}
const client = new Client({
  connectionString: url,
  ssl: { ca: supabasePoolerCa, rejectUnauthorized: true },
});
await client.connect();
try {
  const result = await client.query(sql);
  console.table(result.rows);
} finally {
  await client.end();
}
