#!/usr/bin/env node
// Applies one .sql file to the real Supabase Postgres database named by the
// TALLERIA_DB_URL environment variable. Never reads or prints that
// variable's value, and never runs anything without --confirm: without it,
// this only prints exactly what *would* run, so a mistaken or unattended
// invocation can never touch the real database. The human approval this
// project requires before any real-Supabase change happens in the chat,
// before --confirm is ever passed -- this flag is the technical backstop,
// not a substitute for it.
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

const [, , filePath, flag] = process.argv;
if (!filePath) {
  console.error('Uso: node scripts/apply-migration.mjs <ruta-al-archivo.sql> [--confirm]');
  process.exit(1);
}
const sql = readFileSync(filePath, 'utf8');
if (flag !== '--confirm') {
  console.log(`Vista previa -- no se ha ejecutado nada todavía.\nArchivo: ${filePath}\n\n----- SQL -----\n${sql}\n----- fin -----\n\nPara aplicarlo de verdad: node scripts/apply-migration.mjs ${filePath} --confirm`);
  process.exit(0);
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
  await client.query(sql);
  console.log(`✔ Migración aplicada: ${filePath}`);
} catch (err) {
  console.error(`✘ Error al aplicar la migración: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
