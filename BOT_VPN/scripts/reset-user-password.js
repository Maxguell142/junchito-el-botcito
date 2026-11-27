const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { neon } = require('@neondatabase/serverless');

const scryptAsync = promisify(crypto.scrypt);

function parseArgs(args) {
  const options = { target: 'both', username: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--username' || argument === '--target') {
      const value = args[index + 1];
      if (!value) throw new Error(`Falta un valor para ${argument}.`);
      options[argument === '--username' ? 'username' : 'target'] = value;
      index += 1;
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }
  if (!options.username) throw new Error('Indica el usuario con --username.');
  if (!['local', 'vercel', 'both'].includes(options.target)) {
    throw new Error('--target debe ser local, vercel o both.');
  }
  return options;
}

function readHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Ejecuta este comando desde una terminal interactiva para ocultar la entrada.');
  }

  return new Promise((resolve, reject) => {
    const previousRawMode = Boolean(input.isRaw);
    let value = '';

    const finish = (error, result) => {
      input.removeListener('keypress', onKeypress);
      input.setRawMode(previousRawMode);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };

    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Operación cancelada.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish(null, value);
      } else if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    };

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKeypress);
    process.stdout.write(prompt);
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function passwordMatches(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const [algorithm, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex || '')
    || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
}

function getLocalUser(databasePath, username) {
  if (!fs.existsSync(databasePath)) {
    throw new Error(`No existe la base SQLite local: ${databasePath}`);
  }
  const database = new DatabaseSync(databasePath);
  try {
    return database.prepare(
      'SELECT username, role, status FROM app_users WHERE username = ? COLLATE NOCASE'
    ).get(username) || null;
  } finally {
    database.close();
  }
}

async function getCloudUser(sql, username) {
  const rows = await sql.query(
    'SELECT username, role, status FROM quantum_fx_users WHERE lower(username) = lower($1)',
    [username]
  );
  return rows[0] || null;
}

function updateLocalPassword(databasePath, username, passwordHash) {
  const database = new DatabaseSync(databasePath);
  try {
    const result = database.prepare(
      'UPDATE app_users SET password_hash = ?, updated_at = ? WHERE username = ? COLLATE NOCASE'
    ).run(passwordHash, new Date().toISOString(), username);
    return result.changes;
  } finally {
    database.close();
  }
}

async function updateCloudPassword(sql, username, passwordHash) {
  const rows = await sql.query(
    `UPDATE quantum_fx_users
     SET password_hash = $2, updated_at = now()
     WHERE lower(username) = lower($1)
     RETURNING username`,
    [username, passwordHash]
  );
  if (rows.length) {
    await sql.query('DELETE FROM quantum_fx_sessions WHERE lower(username) = lower($1)', [username]);
  }
  return rows.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databasePath = process.env.BOT_VPN_DB_PATH
    || path.resolve(__dirname, '..', 'bot_vpn.sqlite3');
  const needsLocal = options.target === 'local' || options.target === 'both';
  const needsCloud = options.target === 'vercel' || options.target === 'both';
  let localUser = null;
  let sql = null;
  let cloudUser = null;

  if (needsLocal) localUser = getLocalUser(databasePath, options.username);
  if (needsCloud) {
    let connectionString = process.env.QUANTUM_FX_POSTGRES_URL_NON_POOLING
      || process.env.QUANTUM_FX_POSTGRES_URL;
    if (!connectionString) {
      connectionString = (await readHidden('Pega la URL de Neon (entrada oculta): ')).trim();
    }
    if (!connectionString) throw new Error('No se indicó la URL de conexión de Neon.');
    sql = neon(connectionString);
    cloudUser = await getCloudUser(sql, options.username);
  }

  if (needsLocal && !localUser) throw new Error(`No se encontró ${options.username} en la base local.`);
  if (needsCloud && !cloudUser) throw new Error(`No se encontró ${options.username} en la base de Vercel/Neon.`);

  if (localUser) {
    console.log(`Local: ${localUser.username} (${localUser.role}, ${localUser.status})`);
  }
  if (cloudUser) {
    console.log(`Vercel: ${cloudUser.username} (${cloudUser.role}, ${cloudUser.status})`);
  }
  const confirmation = await readHidden('Escribe SI para restablecer la contraseña de esta cuenta: ');
  if (confirmation !== 'SI') throw new Error('No se realizaron cambios.');

  const password = await readHidden('Nueva contraseña (12 caracteres mínimo): ');
  const repeatedPassword = await readHidden('Repite la nueva contraseña: ');
  if (password.length < 12 || password.length > 1024) {
    throw new Error('La contraseña debe tener entre 12 y 1024 caracteres.');
  }
  if (password !== repeatedPassword) throw new Error('Las contraseñas no coinciden.');
  const passwordHash = await hashPassword(password);
  const completed = [];

  try {
    if (needsLocal) {
      if (!updateLocalPassword(databasePath, options.username, passwordHash)) {
        throw new Error('La cuenta local dejó de existir antes de actualizarla.');
      }
      completed.push('local');
      console.log('Contraseña local restablecida.');
    }
    if (needsCloud) {
      if (!await updateCloudPassword(sql, options.username, passwordHash)) {
        throw new Error('La cuenta de Vercel dejó de existir antes de actualizarla.');
      }
      completed.push('Vercel');
      console.log('Contraseña de Vercel restablecida; sus sesiones anteriores fueron revocadas.');
    }
  } catch (error) {
    if (completed.length) {
      throw new Error(`${error.message} Ya se actualizó: ${completed.join(', ')}. Vuelve a ejecutar el comando para completar el otro entorno.`);
    }
    throw error;
  }

  if (needsLocal) {
    console.log('Reinicia el servidor local para cerrar las sesiones locales que ya estaban abiertas.');
  }
  console.log('La contraseña no se mostró ni se guardó en un archivo.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`No se pudo restablecer la contraseña: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { hashPassword, passwordMatches, updateLocalPassword };
