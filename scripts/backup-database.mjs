#!/usr/bin/env node
// ESTADO (11 de octubre de 2026): ensayado solo en local con datos
// ficticios (restauración idéntica al origen). La primera copia real de
// producción requiere autorización expresa. Procedimiento completo en
// docs/copia-seguridad.md.
//
// Full logical backup of the Supabase Postgres database named by
// TALLERIA_DB_URL, plus an automatic restore test. Read-only against the
// source: it only runs pg_dump/pg_dumpall (through the official Supabase CLI
// and its Docker image) and read-only queries. Never prints the connection
// string or any row: only counts, md5 fingerprints and file hashes.
//
// The backup holds personal data (accounts, customers, sessions): the
// destination must be outside the repository and outside OneDrive, and the
// folder must be kept private. Nothing here ever goes to GitHub.
//
// Usage:
//   node scripts/backup-database.mjs --init-key                once: create the
//                                                             encryption key
//   node scripts/backup-database.mjs --export-key              show the key for
//                                                             the password manager
//                                                             (interactive terminal)
//   node scripts/backup-database.mjs <destination-folder>      backup + verify +
//                                                             encrypt
//   node scripts/backup-database.mjs --verify <backup-folder>  verify again
//   node scripts/backup-database.mjs --decrypt <backup-folder> --out <folder>
//                                                             decrypt to restore
// Options: --source-env NAME (variable with the connection string; default
// TALLERIA_DB_URL), --key-file PATH (DPAPI-protected key; default
// %USERPROFILE%\TALLERIA-COPIAS-PRIVADO\clave\backup-key.dpapi), --key-env NAME
// (raw key from the password manager in a variable, e.g. on another computer),
// --keep-container (leave the restore container for inspection).
//
// Requires Docker running. Files written to <destination>/talleria-<UTC>/:
//   roles.sql, schema.sql, data.sql   official Supabase CLI dump
//   acl.sql                           exact privileges of every function,
//                                     table, view, sequence and column of
//                                     public: schema.sql only revokes from
//                                     PUBLIC, and a Supabase database grants
//                                     anon/authenticated by default when each
//                                     object is created, so without this a
//                                     restore would be more permissive
//   auth-pre.sql, auth-post.sql       structure of the auth schema (pg_dump
//                                     pre-data / post-data, without the
//                                     custom triggers), for a full restore
//                                     outside Supabase and for the test
//   custom-auth-triggers.sql          triggers on auth.users that call public
//                                     functions (not in schema.sql, which
//                                     leaves out the auth schema)
//   manifest.json                     sha256 of every file and fingerprints
// After the restore test passes, every .sql file is encrypted to <name>.enc
// and the plaintext is deleted; manifest.json (hashes only) stays readable.
// Restore order (see docs/copia-seguridad.md): roles, [auth-pre, auth-post
// only outside Supabase], schema, custom-auth-triggers, acl, then data with
// session_replication_role = replica.
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, openSync, closeSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const CLI_VERSION = '2.117.0';
// Same image the CLI uses for its pg_dump, matching the production server
// (PostgreSQL 17.6).
const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabasePoolerCa = readFileSync(join(repoRoot, 'scripts/certs/supabase-pooler-root-ca.pem'), 'utf8');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const verifyDir = opt('--verify');
const decryptDir = opt('--decrypt');
const outDir = opt('--out');
const sourceEnv = opt('--source-env') ?? 'TALLERIA_DB_URL';
const keyFile = opt('--key-file') ?? join(homedir(), 'TALLERIA-COPIAS-PRIVADO', 'clave', 'backup-key.dpapi');
const keyEnv = opt('--key-env');
const initKey = flag('--init-key');
const exportKey = flag('--export-key');
const keepContainer = flag('--keep-container');
const destination = args[0];

// Errors are thrown (never process.exit mid-way) so every finally block --
// in particular the one that removes the restore container -- always runs.
class Stop extends Error {}
const fail = msg => { throw new Stop(msg); };
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
let redact = s => String(s);

// Physical path: symlinks and junctions of the deepest existing ancestor
// resolved, so a link cannot smuggle the backup into the repository.
function physical(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) { const up = dirname(cur); if (up === cur) break; rest.unshift(basename(cur)); cur = up; }
  return join(realpathSync.native(cur), ...rest);
}
// True when child is parent or inside it ('..backup' is a name, not '..').
const inside = (parent, child) => { const r = relative(parent, child); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)); };
function checkOutsideRepoAndOneDrive(dir) {
  const abs = physical(dir);
  if (inside(physical(repoRoot), abs)) fail('La carpeta de destino está dentro del repositorio: elige una carpeta fuera.');
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const od = process.env[v];
    if (od && inside(physical(od), abs)) fail('La carpeta de destino está dentro de OneDrive: elige una carpeta que no se sincronice.');
  }
  return abs;
}

// ---- encryption ----
// Every backup file is encrypted with AES-256-GCM (its name authenticated, so
// files cannot be swapped). The 32-byte key is random and stored protected
// with Windows DPAPI: only the same Windows user on this computer can open it,
// so backups run unattended and the key is never shown. A copy of the raw key
// for disaster recovery is shown only by --export-key, in an interactive
// terminal; elsewhere --key-env NAME reads that copy from a variable.
const DPAPI_ENTROPY = 'TALLERIA-backup-key-v1';
function dpapi(op, inputB64) {
  if (process.platform !== 'win32') fail('La clave protegida con DPAPI solo funciona en Windows; en otro equipo usa --key-env con la copia de la clave.');
  const ps = `Add-Type -AssemblyName System.Security; $in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $e = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}'); $out = [Security.Cryptography.ProtectedData]::${op}($in, $e, 'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($out))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: inputB64, encoding: 'utf8' });
  if (r.status !== 0) fail(`No se pudo ${op === 'Protect' ? 'proteger' : 'abrir'} la clave con DPAPI (solo puede abrirla el mismo usuario de Windows que la creó).`);
  return r.stdout.trim();
}
function loadKey() {
  let key;
  if (keyEnv) {
    const v = process.env[keyEnv];
    if (!v) fail(`Falta la variable de entorno ${keyEnv}.`);
    key = Buffer.from(v.trim(), 'base64');
  } else {
    if (!existsSync(keyFile)) fail(`No existe la clave de cifrado (${keyFile}). Créala con --init-key.`);
    key = Buffer.from(dpapi('Unprotect', readFileSync(keyFile, 'utf8').trim()), 'base64');
  }
  if (key.length !== 32) fail('La clave de cifrado no es válida.');
  return key;
}
// Public identifier of a key (not the key): tells which key a backup needs.
const keyId = key => sha256(Buffer.concat([Buffer.from('talleria-key-id:'), key])).slice(0, 16);
const MAGIC = Buffer.from('TBK1');
function encrypt(key, name, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(name));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function decrypt(key, name, blob) {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) fail(`${name}: no es un archivo cifrado de copia.`);
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAAD(Buffer.from(name));
  d.setAuthTag(blob.subarray(16, 32));
  try { return Buffer.concat([d.update(blob.subarray(32)), d.final()]); } catch { fail(`${name}: no se puede descifrar (clave distinta o archivo alterado).`); }
}

function createKey() {
  const exists = () => fail(`Ya existe una clave en ${keyFile}: no se sobrescribe (las copias cifradas con ella dejarían de poder abrirse).`);
  if (existsSync(keyFile)) exists();
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  const sealed = dpapi('Protect', key.toString('base64')) + '\n';
  // 'wx': exclusive creation, so two runs at once can never replace a key.
  try { writeFileSync(keyFile, sealed, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') exists(); throw e; }
  if (!loadKey().equals(key)) fail('La clave guardada no se pudo volver a abrir.');
  console.log(`✔ Clave de cifrado creada y protegida con DPAPI en ${keyFile} (identificador ${keyId(key)}).`);
  console.log('  Guarda una copia para emergencias en tu gestor de contraseñas con --export-key, desde una terminal tuya.');
}
function showKey() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) fail('Por seguridad, --export-key solo muestra la clave en una terminal interactiva abierta por ti (no en herramientas automáticas ni redirigida a un archivo).');
  const key = loadKey();
  console.log(`Identificador: ${keyId(key)}\nClave (cópiala en tu gestor de contraseñas y no la compartas):\n${key.toString('base64')}`);
}

// Encrypts the verified plaintext files, checks each one decrypts back to the
// manifest hash, then deletes the plaintext.
function encryptBackup(dir, key) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const plain = readFileSync(join(dir, f));
    if (sha256(plain) !== meta.sha256) fail(`${f}: cambió antes de cifrarlo.`);
    const blob = encrypt(key, f, plain);
    writeFileSync(join(dir, f + '.enc'), blob);
    if (sha256(decrypt(key, f, readFileSync(join(dir, f + '.enc')))) !== meta.sha256) fail(`${f}: el archivo cifrado no se descifra igual.`);
    meta.cifrado = { archivo: f + '.enc', bytes: blob.length, sha256: sha256(blob) };
  }
  manifest.cifrado = { algoritmo: 'AES-256-GCM', clave_id: keyId(key) };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const f of Object.keys(manifest.archivos)) rmSync(join(dir, f));
}

// Decrypts an encrypted backup into target (files plus manifest.json).
function decryptBackup(dir, target, key) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.cifrado) fail('Esta copia no está cifrada.');
  if (manifest.cifrado.clave_id !== keyId(key)) fail(`Esta copia se cifró con otra clave (identificador ${manifest.cifrado.clave_id}).`);
  mkdirSync(target, { recursive: true });
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const blob = readFileSync(join(dir, meta.cifrado.archivo));
    if (sha256(blob) !== meta.cifrado.sha256) fail(`${meta.cifrado.archivo}: el archivo cifrado falta o no coincide con el manifiesto.`);
    writeFileSync(join(target, f), decrypt(key, f, blob));
    delete meta.cifrado;
  }
  // The decrypted folder is a plain backup: its manifest says so, so it can be
  // verified again (--verify) before restoring.
  delete manifest.cifrado;
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

function docker(argv, options = {}) {
  const r = spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (r.error) fail('No se pudo ejecutar Docker: ' + r.error.message);
  return r;
}

// ---- source connection (never printed) ----
let source;
function loadSource() {
  const raw = process.env[sourceEnv];
  if (!raw) fail(`Falta la variable de entorno ${sourceEnv}.`);
  let url;
  try { url = new URL(raw); } catch { fail(`${sourceEnv} no es una cadena de conexión válida.`); }
  const password = decodeURIComponent(url.password);
  const secrets = [raw, url.password, password].filter(Boolean);
  redact = s => secrets.reduce((acc, x) => acc.split(x).join('***'), String(s));
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  // Containers reach a database on this machine through host.docker.internal.
  const dockerUrl = new URL(raw);
  if (local) dockerUrl.hostname = 'host.docker.internal';
  source = {
    dockerUrl: dockerUrl.toString(),
    pgEnv: { PGHOST: dockerUrl.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: password, PGDATABASE: url.pathname.slice(1) || 'postgres' },
    client: () => new pg.Client({ connectionString: raw, ssl: local ? false : { ca: supabasePoolerCa, rejectUnauthorized: true } }),
  };
}

// ---- Supabase CLI, pinned, installed and run outside the repository ----
const cliDir = join(tmpdir(), `talleria-supabase-cli-${CLI_VERSION}`);
function supabaseCli() {
  // The npm package's entry point is a Node script (it runs the CLI binary).
  const bin = join(cliDir, 'node_modules', 'supabase', 'dist', 'supabase.js');
  if (!existsSync(bin)) {
    console.log(`Instalando Supabase CLI ${CLI_VERSION} en una carpeta temporal…`);
    mkdirSync(cliDir, { recursive: true });
    const r = spawnSync('npm', ['install', '--prefix', cliDir, `supabase@${CLI_VERSION}`, '--no-audit', '--no-fund'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0 || !existsSync(bin)) fail('No se pudo instalar la CLI de Supabase.');
  }
  return bin;
}

function cliDump(bin, file, extra) {
  // --workdir keeps the CLI's supabase/.temp cache out of the repository.
  const work = join(cliDir, 'work');
  mkdirSync(work, { recursive: true });
  const r = spawnSync(process.execPath, [bin, 'db', 'dump', '--workdir', work, '--db-url', source.dockerUrl, '-f', file, ...extra],
    { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, DO_NOT_TRACK: '1' } });
  if (r.status !== 0) fail(`Falló el volcado ${file.split(/[\\/]/).pop()}:\n` + redact((r.stderr || '') + (r.stdout || '')).split('\n').filter(l => !/new version|recommend updating/i.test(l)).slice(-8).join('\n'));
}

// pg_dump from the same image, credentials passed by environment name only.
function pgDump(file, extra) {
  const fd = openSync(file, 'w');
  try {
    const envNames = Object.keys(source.pgEnv);
    const r = spawnSync('docker', ['run', '--rm', ...envNames.flatMap(n => ['-e', n]), IMAGE, 'pg_dump', '--quote-all-identifiers', ...extra],
      { env: { ...process.env, ...source.pgEnv }, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) fail(`Falló pg_dump (${file.split(/[\\/]/).pop()}):\n` + redact(r.stderr || '').split('\n').slice(-6).join('\n'));
  } finally { closeSync(fd); }
}

// ---- fingerprints: counts and md5 only, computed inside the database ----
// Both sides run them with an empty search_path, so definitions deparse
// identically. ACLs are compared as sorted grantee=privilege lists with the
// default ACL filled in, so neither entry order nor NULL-vs-explicit matters.
const TABLES_SQL = `select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth') and not (n.nspname = 'auth' and c.relname = 'schema_migrations') order by 1, 2`;
const quote = id => '"' + id.replace(/"/g, '""') + '"';
// Sequences of public and auth; their state is read from each sequence
// (pg_sequences.last_value is NULL whenever is_called is false).
const SEQUENCES_SQL = `select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname in ('public', 'auth') order by 1, 2`;
const aclNorm = (acl, kind, owner) => `(select coalesce(string_agg(e, ',' order by e), '') from (select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || '=' || a.privilege_type || case when a.is_grantable then '*' else '' end as e from pg_catalog.aclexplode(coalesce(${acl}, pg_catalog.acldefault(${kind}, ${owner}))) a) z)`;
const RELKINDS = `('r', 'p', 'v', 'm', 'S', 'f')`;
const SCHEMAS = `('public'::regnamespace, 'auth'::regnamespace)`;
function fingerprintSql(tables, sequences) {
  const seqParts = sequences.map(({ s, t }) => `select '${s}.${t}' as k, last_value::text || ':' || is_called as v from ${quote(s)}.${quote(t)}`);
  const parts = tables.map(({ s, t }) =>
    `select '${s}.${t}' as tabla, count(*) as filas, md5(coalesce(string_agg(x, E'\\n' order by x), '')) as huella from (select r::text as x from ${quote(s)}.${quote(t)} r) q`);
  return `select json_build_object(
    'tablas', (select json_object_agg(tabla, json_build_object('filas', filas, 'huella', huella)) from (${parts.join(' union all ')}) f),
    'funciones', (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || pg_get_userbyid(p.proowner) || ':' || ${aclNorm('p.proacl', "'f'::\"char\"", 'p.proowner')}, ',' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace in ${SCHEMAS} and p.prokind = 'f'),
    'permisos', (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || c.relkind::text || ':' || pg_get_userbyid(c.relowner) || ':' || ${aclNorm('c.relacl', "(case when c.relkind = 'S' then 's' else 'r' end)::\"char\"", 'c.relowner')}, ',' order by c.oid::regclass::text), '')) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ${RELKINDS}),
    'permisos_columnas', (select md5(coalesce(string_agg(c.oid::regclass::text || '.' || a.attname || ':' || a.attacl::text, ',' order by c.oid::regclass::text, a.attname), '')) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace in ${SCHEMAS} and a.attacl is not null and not a.attisdropped),
    'rls', (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' order by c.oid::regclass::text), '')) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p')),
    'permisos_esquemas', (select string_agg(n.nspname || '=' || ${aclNorm('n.nspacl', "'n'::\"char\"", 'n.nspowner')}, ';' order by n.nspname) from pg_namespace n where n.nspname in ('public', 'auth')),
    'politicas', (select md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || array_to_string(roles, ',') || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by schemaname, tablename, policyname), '')) from pg_policies where schemaname in ('public', 'auth')),
    'estructura', (select md5(coalesce(string_agg(x, E'\\n' order by x), '')) from (
        select 'columna:' || c.oid::regclass::text || '.' || a.attname || ':' || a.attnum || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || ':' || a.attgenerated::text as x
          from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
        union all select 'restriccion:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated from pg_constraint where connamespace in ${SCHEMAS}
        union all select 'indice:' || i.indexrelid::regclass::text || ':' || pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace in ${SCHEMAS}
        union all select 'trigger:' || t.tgrelid::regclass::text || ':' || pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace in ${SCHEMAS} and not t.tgisinternal
        union all select 'vista:' || c.oid::regclass::text || ':' || pg_get_viewdef(c.oid) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ('v', 'm')
        union all select 'tipo:' || t.oid::regtype::text || ':' || t.typtype::text || ':' || coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = t.oid), '') from pg_type t where t.typnamespace in ${SCHEMAS} and t.typtype in ('e', 'd')
      ) s),
    'secuencias', (select coalesce(json_object_agg(schemaname || '.' || sequencename, data_type || ':' || start_value || ':' || increment_by || ':' || min_value || ':' || max_value || ':' || cycle || ':' || coalesce(last_value::text, 'sin usar')), '{}') from pg_sequences where schemaname in ('public', 'auth')),
    'estado_secuencias', ${seqParts.length ? `(select json_object_agg(k, v) from (${seqParts.join(' union all ')}) q)` : "'{}'::json"},
    'triggers_auth_users', (select coalesce(json_agg(tgname order by tgname), '[]') from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal),
    'version', current_setting('server_version'))::text as j`;
}

// Exact privileges of public's objects as REVOKE/GRANT statements.
const ACL_SQL = `with objs as (
    select 'FUNCTION' as kind, p.oid::regprocedure::text as name, p.proacl as acl, p.proowner as owner, 'f'::"char" as t
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    union all
    select case c.relkind when 'S' then 'SEQUENCE' else 'TABLE' end, c.oid::regclass::text, c.relacl, c.relowner, case c.relkind when 'S' then 's'::"char" else 'r'::"char" end
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ${RELKINDS})
  select 'REVOKE ALL ON ' || o.kind || ' ' || o.name || ' FROM PUBLIC, anon, authenticated, service_role;' ||
    coalesce((select E'\\n' || string_agg(format('GRANT %s ON %s %s TO %s%s;', a.privilege_type, o.kind, o.name,
        case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
        case when a.is_grantable then ' WITH GRANT OPTION' else '' end), E'\\n' order by a.grantee, a.privilege_type)
      from aclexplode(coalesce(o.acl, acldefault(o.t, o.owner))) a where a.grantee <> o.owner), '') as stmt
  from objs o
  union all
  select format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC, anon, authenticated, service_role;', a.attname, c.oid::regclass) ||
    coalesce((select E'\\n' || string_agg(format('GRANT %s (%I) ON TABLE %s TO %s%s;', x.privilege_type, a.attname, c.oid::regclass,
        case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end,
        case when x.is_grantable then ' WITH GRANT OPTION' else '' end), E'\\n' order by x.grantee, x.privilege_type)
      from aclexplode(a.attacl) x), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped
  order by 1`;

async function readSource() {
  const c = source.client();
  await c.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    await c.query("set local search_path = ''");
    const tables = (await c.query(TABLES_SQL)).rows;
    const sequences = (await c.query(SEQUENCES_SQL)).rows;
    const fp = JSON.parse((await c.query(fingerprintSql(tables, sequences))).rows[0].j);
    const triggers = (await c.query(`select pg_get_triggerdef(t.oid) || ';' as d from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and p.pronamespace = 'public'::regnamespace order by t.tgname`)).rows.map(r => r.d);
    const acl = (await c.query(ACL_SQL)).rows.map(r => r.stmt);
    await c.query('commit');
    return { fp, triggers, acl };
  } finally { await c.end(); }
}

// ---- restore test in a throwaway container ----
const LOG = 'restauracion-errores.log';
function restoreAndFingerprint(dir, manifest, logDir) {
  const name = 'talleria-restore-' + randomBytes(4).toString('hex');
  const password = randomBytes(18).toString('hex');
  const run = docker(['run', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD', '-v', `${dir}:/backup:ro`, IMAGE], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (run.status !== 0) fail('No se pudo arrancar el contenedor de prueba: ' + run.stderr);
  const psql = (sqlArgs, input) => docker(['exec', '-i', '-e', 'PGPASSWORD', name, 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...sqlArgs],
    { env: { ...process.env, PGPASSWORD: password }, input });
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      ready = docker(['exec', name, 'pg_isready', '-h', 'localhost', '-U', 'postgres']).status === 0 && psql(['-Atc', 'select 1']).status === 0;
      if (!ready) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
    if (!ready) fail('El contenedor de prueba no llegó a estar listo.');
    // psql diagnostics can quote row values (e.g. a COPY line it rejected):
    // they go to a private log next to the backup (encrypted afterwards),
    // never to the console.
    const log = join(logDir, LOG);
    const step = (label, r) => {
      if (r.status === 0) return r;
      writeFileSync(log, `${new Date().toISOString()} ${label}\n${r.stderr || ''}\n`, { flag: 'a' });
      fail(`${label}: falló (código ${r.status}). El diagnóstico completo, que puede contener datos, se guarda en la carpeta de la copia (cifrado si la copia lo está; se abre con --decrypt).`);
    };
    // The image ships a minimal auth schema; replace it with the backed-up one.
    step('Preparación del contenedor', psql(['-c', 'drop schema if exists auth cascade']));
    step('Restauración de prueba', psql(['--single-transaction', '-f', '/backup/roles.sql', '-f', '/backup/auth-pre.sql', '-f', '/backup/auth-post.sql', '-f', '/backup/schema.sql',
      '-f', '/backup/custom-auth-triggers.sql', '-f', '/backup/acl.sql', '-c', 'set session_replication_role = replica', '-f', '/backup/data.sql']));
    const split = k => { const [s, ...t] = k.split('.'); return { s, t: t.join('.') }; };
    const tables = Object.keys(manifest.huellas.tablas).map(split), sequences = Object.keys(manifest.huellas.estado_secuencias).map(split);
    const r = step('Huellas de la copia restaurada', psql(['-At'], "set search_path = '';\n" + fingerprintSql(tables, sequences)));
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } finally {
    if (keepContainer) console.log(`Contenedor de prueba conservado: ${name} (bórralo con: docker rm -f ${name})`);
    else docker(['rm', '-f', name]);
  }
}

// JSON with sorted keys, so objects compare by content.
const stable = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const COMPARED = ['funciones', 'permisos', 'permisos_columnas', 'rls', 'permisos_esquemas', 'politicas', 'estructura', 'secuencias', 'estado_secuencias'];
function verify(dir, logDir = dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  let ok = true;
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const same = existsSync(join(dir, f)) && sha256(readFileSync(join(dir, f))) === meta.sha256;
    if (!same) { ok = false; console.log(`✘ ${f}: el archivo falta o no coincide con el manifiesto`); }
  }
  if (!ok) fail('La copia está incompleta o modificada.');
  console.log('✔ Archivos íntegros (SHA-256 iguales al manifiesto)');
  const restored = restoreAndFingerprint(dir, manifest, logDir);
  const src = manifest.huellas;
  for (const [t, v] of Object.entries(src.tablas)) {
    const w = restored.tablas?.[t];
    const same = w && Number(w.filas) === Number(v.filas) && w.huella === v.huella;
    if (!same) { ok = false; console.log(`✘ ${t}: ${v.filas} filas en el origen, ${w ? w.filas : 'ninguna'} en la copia restaurada${w && Number(w.filas) === Number(v.filas) ? ' (contenido distinto)' : ''}`); }
  }
  for (const k of COMPARED) if (stable(restored[k]) !== stable(src[k])) { ok = false; console.log(`✘ ${k}: distinto en la copia restaurada`); }
  if (JSON.stringify(restored.triggers_auth_users) !== JSON.stringify(src.triggers_auth_users)) { ok = false; console.log('✘ triggers de auth.users distintos en la copia restaurada'); }
  if (!ok) fail('La restauración de prueba no reproduce el origen.');
  const n = Object.keys(src.tablas).length, rows = Object.values(src.tablas).reduce((a, v) => a + Number(v.filas), 0);
  console.log(`✔ Restauración de prueba idéntica al origen: ${n} tablas (${rows} filas); estructura, secuencias, funciones, permisos, RLS, políticas y triggers`);
}

// The restore diagnostic may quote rows: keep it only encrypted. The
// plaintext log is always removed; the encrypted copy is kept only if it was
// written and decrypts back to the same bytes.
function sealLog(dir, key) {
  const f = join(dir, LOG);
  if (!existsSync(f)) return;
  const name = `restauracion-errores-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.log`;
  const out = join(dir, name + '.enc');
  try {
    const plain = readFileSync(f);
    writeFileSync(out, encrypt(key, name, plain));
    if (!decrypt(key, name, readFileSync(out)).equals(plain)) throw new Error('diagnóstico cifrado distinto');
  } catch {
    rmSync(out, { force: true });
    console.error('✘ No se pudo guardar cifrado el diagnóstico de la restauración; se ha borrado.');
  } finally {
    rmSync(f, { force: true });
  }
}

// Verifies a backup; an encrypted one is decrypted into a temporary folder
// inside the (access-restricted) backup folder, removed afterwards.
function verifyBackup(dir) {
  // Verifying writes decrypted files and a diagnostic into the backup folder:
  // never inside the repository or OneDrive, even if a backup was moved there.
  checkOutsideRepoAndOneDrive(dir);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.cifrado) return verify(dir);
  const key = loadKey();
  const tmp = join(dir, '.descifrado-' + randomBytes(4).toString('hex'));
  try {
    decryptBackup(dir, tmp, key);
    console.log(`✔ Archivos cifrados íntegros y descifrados con la clave ${keyId(key)}`);
    verify(tmp, dir);
  } finally {
    // Independent steps: a failure removing the temporary folder must not
    // stop the diagnostic from being sealed.
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {
      console.error(`✘ No se pudo borrar la carpeta temporal descifrada ${tmp}: bórrala a mano (${e.code ?? e.message}).`);
    } finally { sealLog(dir, key); }
  }
}

function decryptCommand(src, out) {
  if (!out) fail('Indica --out <carpeta> (fuera del repositorio y de OneDrive).');
  const target = checkOutsideRepoAndOneDrive(out);
  if (existsSync(target)) fail('La carpeta de salida ya existe.');
  const key = loadKey();
  const from = resolve(src);
  if (from.endsWith('.enc') && existsSync(from) && !existsSync(join(from, 'manifest.json'))) {
    // A single sealed file, e.g. an encrypted restore diagnostic.
    const name = basename(from).slice(0, -4);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, name), decrypt(key, name, readFileSync(from)));
  } else decryptBackup(from, target, key);
  console.log(`✔ Descifrado en ${target}. Contiene datos personales: bórrala en cuanto termines.`);
}

async function backup() {
  if (!destination) fail('Uso: node scripts/backup-database.mjs <carpeta-destino>   |   --verify <carpeta-de-copia>');
  if (docker(['info', '--format', '{{.ServerVersion}}']).status !== 0) fail('Docker no está en marcha.');
  const base = checkOutsideRepoAndOneDrive(destination);
  loadSource();
  // Unencrypted backups are not allowed: without a usable key, stop before
  // anything is dumped.
  const key = loadKey();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = join(base, `talleria-${stamp}`);
  if (existsSync(dir)) fail('La carpeta de la copia ya existe.');
  mkdirSync(dir, { recursive: true });
  let phase = 'volcado';
  try {
    await backupInto(dir, key, p => { phase = p; });
  } catch (e) {
    // Never leave plaintext personal data behind. If the restore test failed,
    // keep only its diagnostic, encrypted, and mark the folder; otherwise
    // remove the folder this run created.
    if (phase === 'verificación') {
      try { sealLog(dir, key); } finally {
        // Whatever happened while sealing, no plaintext file survives.
        for (const f of readdirSync(dir)) if (!f.endsWith('.enc')) rmSync(join(dir, f), { recursive: true, force: true });
        writeFileSync(join(dir, 'COPIA-NO-VALIDA.txt'), 'La restauración de prueba de esta copia falló y sus archivos se han borrado. Si se pudo guardar, queda solo el diagnóstico, cifrado (descífralo con --decrypt <archivo.enc> --out <carpeta>).\n');
      }
    } else rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

async function backupInto(dir, key, setPhase) {
  const bin = supabaseCli();
  // The dumps run on separate connections. Reading the fingerprints before
  // and after them, and refusing the backup if they differ, detects any
  // change to data, structure, privileges or sequences made in between.
  console.log('Leyendo huellas del origen antes del volcado (solo metadatos, recuentos y md5)…');
  const before = await readSource();
  console.log('Volcando roles, esquema y datos (CLI oficial de Supabase)…');
  cliDump(bin, join(dir, 'roles.sql'), ['--role-only']);
  // --keep-comments: by default the CLI drops every line starting with --,
  // including comments inside function bodies, which changes their source.
  cliDump(bin, join(dir, 'schema.sql'), ['--keep-comments']);
  cliDump(bin, join(dir, 'data.sql'), ['--data-only', '--use-copy']);
  console.log('Volcando la estructura del esquema auth…');
  pgDump(join(dir, 'auth-pre.sql'), ['--schema-only', '--schema=auth', '--section=pre-data']);
  pgDump(join(dir, 'auth-post.sql'), ['--schema-only', '--schema=auth', '--section=post-data']);
  // Triggers on auth tables that call public functions cannot be created
  // before schema.sql; they are restored from custom-auth-triggers.sql.
  const post = readFileSync(join(dir, 'auth-post.sql'), 'utf8');
  writeFileSync(join(dir, 'auth-post.sql'), post.replace(/^CREATE TRIGGER .* EXECUTE FUNCTION "public"\..*$/gm, l => '-- (en custom-auth-triggers.sql) ' + l));
  console.log('Leyendo permisos, triggers y huellas del origen después del volcado…');
  const { fp, triggers, acl } = await readSource();
  if (stable(fp) !== stable(before.fp) || stable(acl) !== stable(before.acl) || stable(triggers) !== stable(before.triggers))
    fail('El origen cambió durante la copia (datos, estructura, permisos o secuencias): la copia no es coherente. Repite la copia en un momento sin actividad.');
  writeFileSync(join(dir, 'custom-auth-triggers.sql'), ['-- Triggers on auth.users that call public functions (recreate them after', '-- restoring into a new Supabase project; schema.sql leaves out the auth schema).', ...triggers, ''].join('\n'));
  writeFileSync(join(dir, 'acl.sql'), ['-- Exact privileges of the public schema objects at backup time. Apply after', '-- schema.sql: a Supabase database grants anon/authenticated by default when', '-- each object is created, and schema.sql does not revoke those grants.', ...acl, ''].join('\n'));
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const manifest = {
    creada: new Date().toISOString(), cli_supabase: CLI_VERSION, imagen: IMAGE, version_servidor: fp.version,
    archivos: Object.fromEntries(files.map(f => { const b = readFileSync(join(dir, f)); return [f, { bytes: b.length, sha256: sha256(b) }]; })),
    huellas: fp,
    aviso: 'Contiene datos personales, contraseñas cifradas y tokens de sesión de las cuentas: guardar en privado, cifrada, fuera del repositorio y sin sincronizar.',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const rows = Object.values(fp.tablas).reduce((a, v) => a + Number(v.filas), 0);
  console.log(`✔ Copia creada: ${files.length} archivos, ${Object.keys(fp.tablas).length} tablas, ${rows} filas, ${fp.triggers_auth_users.length} triggers en auth.users`);
  console.log('Comprobando que se puede restaurar…');
  setPhase('verificación');
  verify(dir);
  setPhase('cifrado');
  encryptBackup(dir, key);
  console.log(`✔ Copia cifrada (AES-256-GCM, clave ${keyId(key)}); los archivos sin cifrar se han borrado`);
  console.log(`Carpeta de la copia: ${dir}`);
}

try {
  if (initKey) createKey();
  else if (exportKey) showKey();
  else if (decryptDir) decryptCommand(decryptDir, outDir);
  else if (verifyDir) verifyBackup(resolve(verifyDir));
  else await backup();
} catch (e) {
  console.error('✘ ' + redact(e instanceof Stop ? e.message : (e?.stack ?? e)));
  process.exitCode = 1;
}
