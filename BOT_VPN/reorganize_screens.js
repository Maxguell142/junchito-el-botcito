const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf-8');

// 1. Limpiar el remanente en tabs
html = html.replace(`<button class="tab-link" onclick="switchTab('noticias')">
        <span class="tab-icon">📰</span> Calendario Macro
      </button>

        <span class="tab-icon">📊</span> Dashboard & Bots
      </button>
      <button class="tab-link" onclick="switchTab('titulares')">`,
`<button class="tab-link" onclick="switchTab('noticias')">
        <span class="tab-icon">📰</span> Calendario Macro
      </button>
      <button class="tab-link" onclick="switchTab('titulares')">`);

// 2. Extraer el contenido de la Landing
const landingStartIdx = html.indexOf('<!-- 0. VISTA LANDING / ONBOARDING & ARQUITECTURA -->');
const dashboardStartIdx = html.indexOf('<!-- 1. VISTA DASHBOARD (BOTS GRID) -->');

if (landingStartIdx === -1 || dashboardStartIdx === -1) {
  console.error('No se pudo ubicar la sección landing o dashboard.');
  process.exit(1);
}

// Extraemos el contenido interno de la landing (sin el tag <section id="view-landing">)
let rawLanding = html.substring(landingStartIdx, dashboardStartIdx);
// Limpiamos los tags de apertura y cierre de section
rawLanding = rawLanding.replace(/<!-- 0\. VISTA LANDING \/ ONBOARDING & ARQUITECTURA -->\s*<section class="tab-view" id="view-landing">/, '');
rawLanding = rawLanding.replace(/<\/section>\s*$/, '');

// Reemplazamos los onclick="enterTerminalWorkspace()" por "goToLoginScreen()"
rawLanding = rawLanding.replace(/onclick="enterTerminalWorkspace\(\)"/g, 'onclick="goToLoginScreen()"');
rawLanding = rawLanding.replace(/Comenzar a Operar en la Terminal ➔/, 'Iniciar Sesión y Entrar al Sistema ➔');

// Ahora construimos la Etapa 1: PANTALLA PÚBLICA DE INICIO Y GUÍA
const screenLandingHtml = `  <!-- ======================================================================
       ETAPA 1: PANTALLA PÚBLICA DE INICIO Y GUÍA INSTITUCIONAL
       ====================================================================== -->
  <div class="app-screen" id="screen-landing">
    <!-- Navbar público elegante (Sin controles de trading ni botones de pánico) -->
    <header class="public-landing-header">
      <div class="brand">
        <div class="brand-logo">
          <span class="logo-icon">▲</span>
          <div class="brand-text">
            <span class="brand-title">QUANTUM FX</span>
            <span class="brand-subtitle">ORQUESTACIÓN MULTI-BOT // CME MNQ FUTURES</span>
          </div>
        </div>
      </div>

      <nav class="public-landing-nav">
        <a href="#landing-pillars" class="public-nav-link">4 Pilares Anti-Baneo</a>
        <a href="#landing-workflow" class="public-nav-link">Flujo Operativo</a>
        <a href="#landing-specs" class="public-nav-link">Infraestructura SOCKS5</a>
      </nav>

      <div class="public-landing-actions" id="landing-auth-action-box">
        <button class="btn btn-primary btn-md" onclick="goToLoginScreen()">
          <span>🔐 Iniciar Sesión</span> ➔
        </button>
      </div>
    </header>

    <!-- Contenedor con scroll de la Landing -->
    <div class="landing-scroll-wrapper">
${rawLanding.trim()}

      <!-- Footer Público -->
      <footer class="public-landing-footer">
        <div class="footer-brand">
          <span class="logo-icon">▲</span> QUANTUM FX // INSTITUTIONAL FUTURES TRADING
        </div>
        <p class="footer-copy">
          Aislamiento de red SOCKS5 estático residencial · Gestión segregada por titular KYC · Cumplimiento estricto de reglas de consistencia de prop firms (Apex, Topstep, Leelo).
        </p>
      </footer>
    </div>
  </div>`;

// 3. Construir la Etapa 2: PANTALLA DE LOGIN
const screenLoginHtml = `  <!-- ======================================================================
       ETAPA 2: PANTALLA DE LOGIN (AUTENTICACIÓN)
       ====================================================================== -->
  <div class="app-screen hidden" id="screen-login">
    <div class="login-page-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-brand">
            <span class="logo-icon">▲</span>
            <div class="login-brand-text">
              <h1>QUANTUM FX</h1>
              <span>INSTITUTIONAL FUTURES TRADING // CME MNQ</span>
            </div>
          </div>
          <p class="login-sub">Acceso Seguro a la Terminal Multi-Bot & Replicación Prop Firms</p>
        </div>

        <form id="login-form" onsubmit="handleLoginSubmit(event)">
          <div class="form-group">
            <label for="login-username">Usuario o ID de Operador</label>
            <input type="text" id="login-username" placeholder="ej. admin" required autocomplete="username">
          </div>

          <div class="form-group">
            <label for="login-password">Contraseña Maestra</label>
            <div class="password-wrap">
              <input type="password" id="login-password" placeholder="••••••••" required autocomplete="current-password">
              <button type="button" class="btn-toggle-pwd" onclick="togglePasswordVisibility('login-password')">👁️</button>
            </div>
          </div>

          <div class="login-helpers">
            <label class="checkbox-label">
              <input type="checkbox" id="login-remember" checked> Recordar Sesión
            </label>
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg" id="btn-login-submit">
            <span>Ingresar al Dashboard</span> ➔
          </button>
        </form>

        <div class="login-back-action">
          <button type="button" class="btn-link" onclick="goToLandingScreen()">
            ← Volver a la Guía de Inicio
          </button>
        </div>

        <div class="login-footer">
          <span>Aislamiento de Red SOCKS5 // Anti-Mirroring & Titulares KYC</span>
        </div>
      </div>
    </div>
  </div>`;

// 4. Ubicar la barra superior main-header y envolver el header, sub-nav y main en screen-terminal
const headerIdx = html.indexOf('<header class="top-nav" id="main-header">');
const mainEndIdx = html.indexOf('  </main>');

if (headerIdx === -1 || mainEndIdx === -1) {
  console.error('No se pudo ubicar main-header o fin de main.');
  process.exit(1);
}

// Extraemos todo el bloque de la terminal (header, sub-nav, main sin landing)
let terminalBlock = html.substring(headerIdx, mainEndIdx + '  </main>'.length);

// Eliminamos la landing que estaba adentro de main-container
terminalBlock = terminalBlock.replace(html.substring(landingStartIdx, dashboardStartIdx), '');

// Ajustamos el botón de la guía en el header de la terminal
terminalBlock = terminalBlock.replace('onclick="toggleLandingView()"', 'onclick="goToLandingScreen()"');
terminalBlock = terminalBlock.replace('<span>🏠</span> Guía / Inicio', '<span>🏠</span> Ver Guía');

// Envolvemos en screen-terminal
const screenTerminalHtml = `  <!-- ======================================================================
       ETAPA 3: DASHBOARD & TERMINAL INSTITUCIONAL (SOLO USUARIOS AUTENTICADOS)
       ====================================================================== -->
  <div class="app-screen hidden" id="screen-terminal">
${terminalBlock}
  </div>`;

// 5. Extraer modales y scripts
const afterMain = html.substring(mainEndIdx + '  </main>'.length);

// Reconstruir el documento HTML completo
const headHtml = html.substring(0, html.indexOf('<body>') + '<body>'.length);

const finalHtml = `${headHtml}

${screenLandingHtml}

${screenLoginHtml}

${screenTerminalHtml}

${afterMain.trim()}
</body>
</html>`;

fs.writeFileSync(indexPath, finalHtml, 'utf-8');
console.log('index.html reorganizado con éxito en 3 etapas limpias!');
