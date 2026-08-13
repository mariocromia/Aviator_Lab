export const splashHtml = String.raw`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aviator Strategy Lab</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #090c10; }
      body {
        display: grid;
        place-items: center;
        color: #e8edf5;
        background:
          radial-gradient(circle at 50% 15%, rgba(53, 127, 255, .18), transparent 42%),
          linear-gradient(145deg, #111720 0%, #090c10 72%);
        user-select: none;
      }
      .shell { width: 100%; height: 100%; display: grid; place-items: center; position: relative; border: 1px solid #27313e; }
      .shell::before { content: ""; position: absolute; inset: 0; opacity: .18; background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size: 28px 28px; }
      .content { width: 410px; text-align: center; position: relative; z-index: 1; }
      .mark { width: 82px; height: 82px; margin: 0 auto 18px; position: relative; display: grid; place-items: center; }
      .ring, .ring::after { position: absolute; inset: 0; border-radius: 50%; border: 2px solid transparent; }
      .ring { border-top-color: #3b82f6; border-right-color: rgba(59,130,246,.2); animation: spin 1.35s linear infinite; filter: drop-shadow(0 0 8px rgba(59,130,246,.5)); }
      .ring::after { content: ""; inset: 8px; border-bottom-color: #22c55e; border-left-color: rgba(34,197,94,.16); animation: spin-reverse 1s linear infinite; }
      .symbol { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: white; font-weight: 900; font-size: 24px; letter-spacing: -2px; background: linear-gradient(145deg, #2563eb, #123a85); box-shadow: 0 10px 30px rgba(37,99,235,.35); animation: breathe 1.8s ease-in-out infinite; }
      h1 { margin: 0; font-size: 22px; letter-spacing: .01em; }
      .subtitle { margin: 6px 0 22px; color: #8390a1; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }
      .track { height: 5px; overflow: hidden; border-radius: 999px; background: #1c2530; box-shadow: inset 0 0 0 1px rgba(255,255,255,.03); }
      .bar { width: 8%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #60a5fa, #22c55e); transition: width .45s ease; position: relative; }
      .bar::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent); transform: translateX(-100%); animation: shimmer 1.25s ease-in-out infinite; }
      .status-row { min-height: 22px; margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #aeb9c8; font-size: 12px; }
      .status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .percent { color: #60a5fa; font-variant-numeric: tabular-nums; }
      .hint { margin-top: 13px; color: #596575; font-size: 11px; }
      .shell.slow .hint { color: #d3a94e; }
      .shell.error .bar { background: #ef4444; }
      .shell.error .status, .shell.error .percent, .shell.error .hint { color: #fca5a5; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes spin-reverse { to { transform: rotate(-360deg); } }
      @keyframes breathe { 50% { transform: scale(.94); filter: brightness(1.25); } }
      @keyframes shimmer { to { transform: translateX(180%); } }
    </style>
  </head>
  <body>
    <main class="shell" id="shell">
      <section class="content" aria-live="polite">
        <div class="mark"><div class="ring"></div><div class="symbol">A</div></div>
        <h1>Aviator Strategy Lab</h1>
        <p class="subtitle">Central de Estratégias</p>
        <div class="track"><div class="bar" id="bar"></div></div>
        <div class="status-row"><span class="status" id="status">Preparando o ambiente...</span><span class="percent" id="percent">8%</span></div>
        <div class="hint" id="hint">A primeira abertura pode levar alguns segundos.</div>
      </section>
    </main>
    <script>
      window.setSplashState = function (message, progress, isError) {
        var safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
        document.getElementById('status').textContent = message;
        document.getElementById('bar').style.width = safeProgress + '%';
        document.getElementById('percent').textContent = safeProgress + '%';
        document.getElementById('shell').classList.toggle('error', Boolean(isError));
        if (isError) document.getElementById('hint').textContent = 'Não foi possível concluir a inicialização.';
      };
      window.setTimeout(function () {
        var shell = document.getElementById('shell');
        if (!shell.classList.contains('error')) {
          shell.classList.add('slow');
          document.getElementById('hint').textContent = 'Ainda estamos carregando. O sistema continua respondendo.';
        }
      }, 12000);
    </script>
  </body>
</html>`;
