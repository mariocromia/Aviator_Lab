# Arquitetura inicial

## Princípios

- Um collector por plataforma, distribuindo `RoundEvent` para vários Terminais.
- Runtime, estratégia, banca e histórico sempre isolados por `terminalId`.
- Processo renderer sem acesso direto a Node ou SQLite; toda capacidade passa pela API tipada do preload.
- Serviços de autenticação, licença e acesso a recursos desacoplados.
- Valores monetários futuros serão armazenados em centavos inteiros.

## Entrega 0.1

Esta base implementa o shell Electron, autenticação local MASTER com senha em hash, SQLite, seeds, sessão local, dashboard e operações iniciais de Terminais e Plataformas.

Collector TipMiner, engines de estratégia, replay, backtest e Screen Agent pertencem às fases seguintes. Os contratos e a navegação já reservam essas fronteiras sem simular automação financeira.

## Entrega 0.2 — Collector TipMiner

- `TipMinerClient` conhece somente transporte HTTP e usa o stack de rede do Electron.
- Polling é um loop sequencial `await poll → await sleep`; não usa `setInterval`.
- `TipMinerRoundNormalizer` valida o payload real, normaliza e ordena por `occurredAt ASC`.
- `RoundDeduplicator` mantém estado por `platformId`; SQLite possui `UNIQUE(platform_id, dedup_key)` como segunda proteção.
- A primeira carga e lacunas com várias rodadas são `BACKLOG`; uma rodada nova em sincronização normal é `LIVE`.
- Rodadas são persistidas uma única vez por plataforma e aparecem newest-first no Monitor ao vivo.
- Um único collector é criado para cada plataforma, independentemente da quantidade de Terminais.

## Entrega 0.3 — Multi-terminal

- `RoundEventBus` possui inscrições por `platformId` e entrega a mesma rodada persistida aos Terminais correspondentes.
- `TerminalManager` controla criação, duplicação, exclusão, pausa, retomada e ciclo de vida dos runtimes.
- Cada Terminal possui `TerminalRuntime` próprio, persistido separadamente no SQLite.
- `terminal_round_receipts` garante que uma rodada seja processada no máximo uma vez por Terminal.
- Pausar um Terminal remove somente sua inscrição; outros runtimes da mesma plataforma continuam processando.
- A duplicação copia configuração e banca inicial, mas cria identidade, runtime e histórico operacional novos.
- Falha de um subscriber é isolada e contabilizada sem impedir a entrega aos demais Terminais.

## Segurança Electron

- `contextIsolation: true`
- `nodeIntegration: false`
- sandbox do renderer habilitado
- API mínima exposta pelo preload
- validação Zod em entradas IPC
